// worker/lib/boards.js
//
// Boards in D1 (PROPOSAL.md §4). Players only ever read the published
// snapshot; admins/imports write the draft and publish it.

import { boardStats, buildSnapshot, imageIdsOf, slugify, titleKey } from '../../src/shared/boards.js';
import { all, audit, first, newId, now } from './db.js';
import { imagesByIds } from './images.js';
import { HttpError } from './http.js';

const LIST_COLUMNS = 'id, slug, title, emoji, description, published_rev AS rev, published_at';

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

/** A slug nobody uses yet, derived from the title. */
async function uniqueSlug(env, title) {
    const base = slugify(title);
    for (let n = 1; n < 1000; n++) {
        const slug = n === 1 ? base : `${base}-${n}`;
        if (!(await first(env, 'SELECT 1 AS x FROM boards WHERE slug = ?', slug))) return slug;
    }
    throw new HttpError(409, 'slug_exhausted');
}

/**
 * Create a board (status 'draft' unless given). Titles are unique across all
 * boards, archived ones included.
 */
export async function createBoard(env, {
    title, emoji = '🎲', description = null, draft, status = 'draft',
    source = 'manual', slug = null, externalKey = null, importRunId = null, actor = null,
}) {
    const key = titleKey(title);
    if (!key) throw new HttpError(400, 'title_required');
    if (await first(env, 'SELECT 1 AS x FROM boards WHERE title_key = ?', key)) {
        throw new HttpError(409, 'title_taken', 'Another board already uses that name.');
    }

    const images = await imagesByIds(env, imageIdsOf(draft));
    const stats = boardStats(draft, images);
    const id = newId('brd');
    const t = now();
    await env.DB.prepare(`
        INSERT INTO boards (id, slug, title, title_key, emoji, description, status, source,
            import_run_id, external_key, draft_json, rev, tiles_ready, flagged_tiles,
            created_at, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`).bind(
        id, slug || await uniqueSlug(env, title), String(title).trim(), key, emoji, description, status, source,
        importRunId, externalKey, JSON.stringify(draft), stats.tilesReady, stats.flaggedTiles,
        t, t, actor,
    ).run();
    await audit(env, { actor, action: 'board.create', boardId: id, detail: { title, source } });
    return first(env, 'SELECT * FROM boards WHERE id = ?', id);
}

/**
 * Publish the board's current draft: build the snapshot players get, store it,
 * keep a revision row, mark the board published.
 * (M2 adds the publish gate — the shared validation — in front of this.)
 */
export async function publishBoard(env, boardId, { actor = null } = {}) {
    const board = await first(env, 'SELECT * FROM boards WHERE id = ?', boardId);
    if (!board) throw new HttpError(404, 'not_found');

    const draft = JSON.parse(board.draft_json);
    const images = await imagesByIds(env, imageIdsOf(draft));
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
    await audit(env, { actor, action: 'board.publish', boardId, detail: { rev: board.rev } });
    return snapshot;
}
