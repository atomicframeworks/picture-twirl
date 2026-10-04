// worker/lib/boards.js
//
// Boards in D1 (PROPOSAL.md §4). Players only ever read the published
// snapshot; admins/imports write the draft and publish it.
// -----------------------------------------------------------------------------
// Status machine (§4.3):
//   import ─┬─ publish ─→ published ─ unpublish ─→ draft
//   draft  ─┘                 │  "publish changes" (republish) stays published
//   any (not archived) ─ archive ─→ archived ─ restore ─→ draft
// Autosave writes the draft with optimistic concurrency on `rev`.
// -----------------------------------------------------------------------------

import {
    boardStats, buildSnapshot, emptyDraft, imageIdsOf, LIMITS, normalizeDraft, slugify, titleKey, validateForPublish,
} from '../../src/shared/boards.js';
import { all, audit, first, newId, now } from './db.js';
import { imagesByIds, publicImage } from './images.js';
import { HttpError } from './http.js';

const LIST_COLUMNS = 'id, slug, title, emoji, description, published_rev AS rev, published_at';

/** Columns the admin table needs (no big JSON). */
const ADMIN_COLUMNS = `id, slug, title, emoji, description, status, source, import_run_id, tiles_ready,
    flagged_tiles, rev, published_rev, published_at, created_at, updated_at, updated_by, archived_at`;

// ── Players ──────────────────────────────────────────────────────────────────

/** Published boards for the pickers, alphabetical. */
export function listPublishedBoards(env) {
    return all(env, `SELECT ${LIST_COLUMNS} FROM boards WHERE status = 'published' ORDER BY title COLLATE NOCASE`);
}

/** A published board's snapshot by id or slug, or null. */
export async function getPublishedBoard(env, idOrSlug) {
    const row = await first(env,
        `SELECT published_json FROM boards WHERE status = 'published' AND (id = ? OR slug = ?)`,
        idOrSlug, idOrSlug);
    return row?.published_json ? JSON.parse(row.published_json) : null;
}

// ── Admin reads ──────────────────────────────────────────────────────────────

/** Every board (all statuses) for the admin table, newest edits first. */
export async function listBoardsForAdmin(env) {
    const rows = await all(env, `SELECT ${ADMIN_COLUMNS} FROM boards ORDER BY updated_at DESC`);
    return rows.map(adminSummary);
}

/** Admin list row + derived "has unpublished changes". */
export function adminSummary(row) {
    const { draft_json: _d, published_json: _p, title_key: _t, external_key: _e, ...rest } = row;
    return { ...rest, unpublished_changes: row.status === 'published' && row.rev > (row.published_rev ?? 0) };
}

/** Everything the editor needs: summary, draft, pictures, publish check. */
export async function getBoardForAdmin(env, id) {
    const row = await first(env, 'SELECT * FROM boards WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'not_found');
    const draft = normalizeDraft(JSON.parse(row.draft_json));
    const images = await imagesByIds(env, imageIdsOf(draft));
    return {
        board: adminSummary(row),
        draft,
        images: Object.fromEntries([...images].map(([k, v]) => [k, publicImage(v)])),
        validation: validateForPublish({ title: row.title, emoji: row.emoji, draft, imagesById: images }),
    };
}

/** Is `title` free? (`exceptId` = the board being renamed) */
export async function titleAvailable(env, title, exceptId = null) {
    const key = titleKey(title);
    if (!key) return false;
    const row = await first(env, 'SELECT id FROM boards WHERE title_key = ?', key);
    return !row || row.id === exceptId;
}

// ── Create / save ────────────────────────────────────────────────────────────

/** A slug nobody uses yet, derived from the title. */
async function uniqueSlug(env, title) {
    const base = slugify(title);
    for (let n = 1; n < 1000; n++) {
        const slug = n === 1 ? base : `${base}-${n}`;
        if (!(await first(env, 'SELECT 1 AS x FROM boards WHERE slug = ?', slug))) return slug;
    }
    throw new HttpError(409, 'slug_exhausted');
}

function cleanTitle(title) {
    const t = String(title ?? '').trim().replace(/\s+/g, ' ');
    if (!t) throw new HttpError(400, 'title_required', 'The board needs a name.');
    if (t.length > LIMITS.TITLE) throw new HttpError(400, 'title_too_long', `Names can be up to ${LIMITS.TITLE} characters.`);
    return t;
}

function cleanEmoji(emoji) {
    const e = String(emoji ?? '').trim().slice(0, LIMITS.EMOJI);
    return e || '🎲';
}

function cleanDescription(description) {
    const d = String(description ?? '').trim().slice(0, LIMITS.DESCRIPTION);
    return d || null;
}

/** Throw 400 if the draft references pictures that don't exist. */
async function assertImagesExist(env, draft) {
    const ids = imageIdsOf(draft);
    const images = await imagesByIds(env, ids);
    const missing = ids.filter(id => !images.has(id));
    if (missing.length) throw new HttpError(400, 'unknown_image', `Unknown picture: ${missing[0]}`);
    return images;
}

/**
 * Create a board (status 'draft' unless given). Titles are unique across all
 * boards, archived ones included.
 */
export async function createBoard(env, {
    title, emoji = '🎲', description = null, draft = emptyDraft(), status = 'draft',
    source = 'manual', slug = null, externalKey = null, importRunId = null, actor = null,
}) {
    const cleanT = cleanTitle(title);
    const key = titleKey(cleanT);
    if (await first(env, 'SELECT 1 AS x FROM boards WHERE title_key = ?', key)) {
        throw new HttpError(409, 'title_taken', 'Another board already uses that name.');
    }
    const cleanDraft = normalizeDraft(draft);
    const images = await assertImagesExist(env, cleanDraft);
    const stats = boardStats(cleanDraft, images);
    const id = newId('brd');
    const t = now();
    await env.DB.prepare(`
        INSERT INTO boards (id, slug, title, title_key, emoji, description, status, source,
            import_run_id, external_key, draft_json, rev, tiles_ready, flagged_tiles,
            created_at, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`).bind(
        id, slug || await uniqueSlug(env, cleanT), cleanT, key, cleanEmoji(emoji), cleanDescription(description), status, source,
        importRunId, externalKey, JSON.stringify(cleanDraft), stats.tilesReady, stats.flaggedTiles,
        t, t, actor,
    ).run();
    await audit(env, { actor, action: 'board.create', boardId: id, detail: { title: cleanT, source } });
    return first(env, 'SELECT * FROM boards WHERE id = ?', id);
}

/**
 * Autosave: write title/emoji/description/draft if `rev` is still current.
 * Bumps rev; a stale rev → 409 { error: 'stale', rev } so the editor can reload.
 */
export async function saveBoard(env, id, { rev, title, emoji, description, draft }, actor = null) {
    const row = await first(env, 'SELECT * FROM boards WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'not_found');
    if (row.status === 'archived') throw new HttpError(409, 'archived', 'Restore this board before editing it.');
    if (Number(rev) !== row.rev) throw new HttpError(409, 'stale', 'This board changed somewhere else.', { rev: row.rev });

    const nextTitle = title === undefined ? row.title : cleanTitle(title);
    const renamed = nextTitle !== row.title;
    if (renamed && !(await titleAvailable(env, nextTitle, id))) {
        throw new HttpError(409, 'title_taken', 'Another board already uses that name.');
    }
    const nextDraft = draft === undefined ? JSON.parse(row.draft_json) : normalizeDraft(draft);
    const images = await assertImagesExist(env, nextDraft);
    const stats = boardStats(nextDraft, images);

    const res = await env.DB.prepare(`UPDATE boards SET title = ?, title_key = ?, emoji = ?, description = ?,
        draft_json = ?, tiles_ready = ?, flagged_tiles = ?, rev = rev + 1, updated_at = ?, updated_by = ?
        WHERE id = ? AND rev = ?`).bind(
        nextTitle, titleKey(nextTitle),
        emoji === undefined ? row.emoji : cleanEmoji(emoji),
        description === undefined ? row.description : cleanDescription(description),
        JSON.stringify(nextDraft), stats.tilesReady, stats.flaggedTiles, now(), actor, id, row.rev,
    ).run();
    if (!res.meta?.changes) {
        const current = await first(env, 'SELECT rev FROM boards WHERE id = ?', id);
        throw new HttpError(409, 'stale', 'This board changed somewhere else.', { rev: current?.rev });
    }
    if (renamed) await audit(env, { actor, action: 'board.rename', boardId: id, detail: { from: row.title, to: nextTitle } });

    const saved = await first(env, 'SELECT * FROM boards WHERE id = ?', id);
    return {
        board: adminSummary(saved),
        validation: validateForPublish({ title: saved.title, emoji: saved.emoji, draft: nextDraft, imagesById: images }),
    };
}

// ── Status changes ───────────────────────────────────────────────────────────

/**
 * Publish the board's current draft: run the publish gate, build the snapshot
 * players get, store it, keep a revision row, mark the board published.
 * Also "Publish changes" for an already-published board.
 */
export async function publishBoard(env, boardId, { actor = null } = {}) {
    const board = await first(env, 'SELECT * FROM boards WHERE id = ?', boardId);
    if (!board) throw new HttpError(404, 'not_found');
    if (board.status === 'archived') throw new HttpError(409, 'archived', 'Restore this board before publishing it.');

    const draft = normalizeDraft(JSON.parse(board.draft_json));
    const images = await imagesByIds(env, imageIdsOf(draft));
    const check = validateForPublish({ title: board.title, emoji: board.emoji, draft, imagesById: images });
    if (!check.ok) {
        throw new HttpError(422, 'not_ready', `${board.title} isn’t ready: ${check.problems[0].message}`, { problems: check.problems });
    }

    const snapshot = buildSnapshot({ board, draft, rev: board.rev, imagesById: images });
    const snapshotJson = JSON.stringify(snapshot);
    const t = now();
    await env.DB.batch([
        env.DB.prepare(`UPDATE boards SET status = 'published', published_json = ?, published_rev = rev,
            published_at = ?, updated_at = ?, updated_by = ?, archived_at = NULL WHERE id = ?`)
            .bind(snapshotJson, t, t, actor, boardId),
        env.DB.prepare(`INSERT OR REPLACE INTO board_revisions (board_id, rev, published_json, published_at, published_by)
            VALUES (?, ?, ?, ?, ?)`).bind(boardId, board.rev, snapshotJson, t, actor),
    ]);
    await audit(env, { actor, action: 'board.publish', boardId, detail: { rev: board.rev, title: board.title } });
    return snapshot;
}

const TRANSITIONS = {
    unpublish: { from: ['published'], to: 'draft', verb: 'moved to draft' },
    archive: { from: ['draft', 'published', 'import'], to: 'archived', verb: 'archived' },
    restore: { from: ['archived'], to: 'draft', verb: 'restored' },
};

/** unpublish | archive | restore (see the status machine at the top). */
export async function changeBoardStatus(env, boardId, action, { actor = null } = {}) {
    const rule = TRANSITIONS[action];
    if (!rule) throw new HttpError(400, 'bad_action');
    const board = await first(env, 'SELECT id, title, status FROM boards WHERE id = ?', boardId);
    if (!board) throw new HttpError(404, 'not_found');
    if (!rule.from.includes(board.status)) {
        throw new HttpError(409, 'invalid_transition', `${board.title} is ${board.status}; it can’t be ${rule.verb}.`);
    }
    const t = now();
    await env.DB.prepare(`UPDATE boards SET status = ?, archived_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
        .bind(rule.to, rule.to === 'archived' ? t : null, t, actor, boardId).run();
    await audit(env, { actor, action: `board.${action}`, boardId, detail: { title: board.title } });
    return adminSummary(await first(env, 'SELECT * FROM boards WHERE id = ?', boardId));
}

/** Copy a board into a new draft named "Copy of …" (made unique). */
export async function duplicateBoard(env, boardId, { actor = null } = {}) {
    const board = await first(env, 'SELECT * FROM boards WHERE id = ?', boardId);
    if (!board) throw new HttpError(404, 'not_found');
    const base = `Copy of ${board.title}`.slice(0, LIMITS.TITLE);
    let title = base;
    for (let n = 2; !(await titleAvailable(env, title)); n++) title = `${base.slice(0, LIMITS.TITLE - 5)} (${n})`;
    return createBoard(env, {
        title, emoji: board.emoji, description: board.description, draft: JSON.parse(board.draft_json),
        source: 'manual', actor,
    });
}

/** Run one action on many boards; never stops at the first failure. */
export async function bulkBoardAction(env, action, ids, { actor = null } = {}) {
    const done = [];
    const skipped = [];
    for (const id of [...new Set(ids)].slice(0, 200)) {
        try {
            if (action === 'publish') await publishBoard(env, id, { actor });
            else await changeBoardStatus(env, id, action, { actor });
            done.push(id);
        } catch (err) {
            if (!(err instanceof HttpError)) throw err;
            skipped.push({ id, code: err.code, message: err.message });
        }
    }
    return { done, skipped };
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export async function adminStats(env) {
    const counts = { published: 0, draft: 0, import: 0, archived: 0 };
    for (const r of await all(env, 'SELECT status, COUNT(*) AS n FROM boards GROUP BY status')) counts[r.status] = r.n;

    const one = async (sql) => (await first(env, sql)) ?? {};
    const attention = {
        imports: counts.import,
        unpublishedChanges: (await one(`SELECT COUNT(*) AS n FROM boards WHERE status = 'published' AND rev > published_rev`)).n ?? 0,
        nearlyReady: (await one(`SELECT COUNT(*) AS n FROM boards WHERE status IN ('draft','import') AND tiles_ready BETWEEN 20 AND 24`)).n ?? 0,
        flaggedTiles: (await one(`SELECT COALESCE(SUM(flagged_tiles), 0) AS n FROM boards WHERE status != 'archived'`)).n ?? 0,
        boardsWithFlags: (await one(`SELECT COUNT(*) AS n FROM boards WHERE status != 'archived' AND flagged_tiles > 0`)).n ?? 0,
        blockedPictures: (await one(`SELECT COUNT(*) AS n FROM images WHERE rights_status = 'blocked'`)).n ?? 0,
    };
    const pics = await one('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM images');
    const tiles = await one(`SELECT COALESCE(SUM(tiles_ready), 0) AS n FROM boards WHERE status != 'archived'`);
    const recent = (await all(env, `SELECT ${ADMIN_COLUMNS} FROM boards ORDER BY updated_at DESC LIMIT 6`)).map(adminSummary);
    return {
        counts,
        attention,
        totals: { boards: Object.values(counts).reduce((a, b) => a + b, 0), tilesReady: tiles.n ?? 0, pictures: pics.n ?? 0, bytes: pics.bytes ?? 0 },
        recent,
        activity: await listAudit(env, { limit: 10 }),
    };
}

/** Audit log with board titles, newest first. */
export async function listAudit(env, { limit = 100, boardId = null } = {}) {
    const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const rows = boardId
        ? await all(env, `SELECT a.*, b.title AS board_title, b.emoji AS board_emoji FROM audit_log a
              LEFT JOIN boards b ON b.id = a.board_id WHERE a.board_id = ? ORDER BY a.id DESC LIMIT ?`, boardId, n)
        : await all(env, `SELECT a.*, b.title AS board_title, b.emoji AS board_emoji FROM audit_log a
              LEFT JOIN boards b ON b.id = a.board_id ORDER BY a.id DESC LIMIT ?`, n);
    return rows.map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
}
