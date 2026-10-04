// src/shared/boards.js
//
// Board shape + helpers shared by the game, the admin and the Worker
// (PROPOSAL.md §4). A Board is 5 categories (columns) × 5 tiles (rows);
// a tile's points come from its row.
// -----------------------------------------------------------------------------
// draft (what admins edit; stored in boards.draft_json):
//   { points: [100…500],
//     categories: [{ title, tiles: [{ answer, imageId, notes }] }] }
//
// snapshot (what players get; stored in boards.published_json):
//   { id, slug, rev, title, emoji, description, points,
//     categories: [{ title,
//       tiles: [{ answer, image: { url, thumb, width, height }, credit }] }] }
// -----------------------------------------------------------------------------

import { creditFor, RIGHTS_FLAGS } from './rights.js';

export const CATEGORY_COUNT = 5;
export const TILES_PER_CATEGORY = 5;
export const DEFAULT_POINTS = [100, 200, 300, 400, 500];

/** Text limits (characters). Enforced by the Worker, mirrored in the admin inputs. */
export const LIMITS = {
    TITLE: 60,
    DESCRIPTION: 140,
    EMOJI: 16,
    CATEGORY_TITLE: 40,
    ANSWER: 80,
    NOTES: 500,
};

/** Smallest long edge (px) before a picture gets a "small picture" warning. */
export const MIN_PICTURE_EDGE = 480;

const IMAGE_ID_RE = /^img_[a-z0-9]{16}$/;

/** Public URL of a stored media object (served by the Worker from R2). */
export const mediaUrl = (key) => (key ? `/media/${key}` : '');

/** Normalized title used for "no two boards share a name". */
export function titleKey(title) {
    return String(title ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** URL-safe slug from a title: "Pop Culture Icons!" → "pop-culture-icons". */
export function slugify(title) {
    const slug = titleKey(title)
        .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip accents
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48)
        .replace(/-+$/, '');
    return slug || 'board';
}

/** A blank 5×5 draft. */
export function emptyDraft() {
    return {
        points: [...DEFAULT_POINTS],
        categories: Array.from({ length: CATEGORY_COUNT }, () => ({
            title: '',
            tiles: Array.from({ length: TILES_PER_CATEGORY }, () => ({ answer: '', imageId: null, notes: '' })),
        })),
    };
}

/**
 * Coerce anything a client sends into a well-formed 5×5 draft: exact shape,
 * strings capped (not trimmed — the admin autosaves while people type),
 * malformed image ids dropped, points validated. Never throws.
 * @param {any} input
 */
export function normalizeDraft(input) {
    const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
    const points = Array.isArray(input?.points) && input.points.length === TILES_PER_CATEGORY
        && input.points.every(p => Number.isInteger(p) && p > 0 && p <= 100000)
        ? [...input.points]
        : [...DEFAULT_POINTS];
    const cats = Array.isArray(input?.categories) ? input.categories : [];
    return {
        points,
        categories: Array.from({ length: CATEGORY_COUNT }, (_, c) => {
            const cat = cats[c] || {};
            const tiles = Array.isArray(cat.tiles) ? cat.tiles : [];
            return {
                title: str(cat.title, LIMITS.CATEGORY_TITLE),
                tiles: Array.from({ length: TILES_PER_CATEGORY }, (_, r) => {
                    const t = tiles[r] || {};
                    return {
                        answer: str(t.answer, LIMITS.ANSWER),
                        imageId: typeof t.imageId === 'string' && IMAGE_ID_RE.test(t.imageId) ? t.imageId : null,
                        notes: str(t.notes, LIMITS.NOTES),
                    };
                }),
            };
        }),
    };
}

/** Display name for a category in messages: its title, or "Category 3". */
const catLabel = (cat, c) => (String(cat?.title ?? '').trim() || `Category ${c + 1}`);

/**
 * The publish gate (PROPOSAL.md §4.3). Problems block publishing; warnings
 * don't (⚠️ rights flags are allowed — decided 2026-10-03).
 * @param {{ title: string, emoji: string, draft: object, imagesById: Map<string, object> }} args
 * @returns {{ ok: boolean, problems: Array<{code: string, message: string, cat?: number, row?: number}>,
 *             warnings: Array<{code: string, message: string, cat?: number, row?: number}> }}
 */
export function validateForPublish({ title, emoji, draft, imagesById = new Map() }) {
    const problems = [];
    const warnings = [];
    const points = draft?.points ?? DEFAULT_POINTS;

    if (!String(title ?? '').trim()) problems.push({ code: 'title_missing', message: 'The board needs a name.' });
    if (!String(emoji ?? '').trim()) problems.push({ code: 'emoji_missing', message: 'Pick an emoji for the board.' });

    const answers = new Map(); // normalized answer → first "where"
    (draft?.categories ?? []).forEach((cat, c) => {
        const name = catLabel(cat, c);
        if (!String(cat.title ?? '').trim()) {
            problems.push({ code: 'category_title_missing', message: `Category ${c + 1} needs a name.`, cat: c });
        }
        (cat.tiles ?? []).forEach((tile, r) => {
            const where = `${name} · ${points[r]}`;
            const answer = String(tile.answer ?? '').trim();
            if (!tile.imageId) {
                problems.push({ code: 'picture_missing', message: `${where}: add a picture.`, cat: c, row: r });
            } else {
                const img = imagesById.get(tile.imageId);
                if (!img) {
                    problems.push({ code: 'picture_unknown', message: `${where}: the picture is missing — upload it again.`, cat: c, row: r });
                } else if (img.rights_status === 'blocked') {
                    problems.push({ code: 'picture_blocked', message: `${where}: this picture's license doesn't allow how we use pictures — replace it.`, cat: c, row: r });
                } else {
                    if (img.rights_status === 'flagged') {
                        const flags = safeJson(img.rights_flags, []).map(f => RIGHTS_FLAGS[f]?.label).filter(Boolean);
                        warnings.push({ code: 'picture_flagged', message: `${where}: ⚠️ ${flags.join(', ') || 'rights to double-check'}.`, cat: c, row: r });
                    }
                    if (Math.max(img.width || 0, img.height || 0) < MIN_PICTURE_EDGE) {
                        warnings.push({ code: 'picture_small', message: `${where}: small picture (${img.width}×${img.height}); it may look blurry.`, cat: c, row: r });
                    }
                }
            }
            if (!answer) {
                problems.push({ code: 'answer_missing', message: `${where}: add the answer.`, cat: c, row: r });
            } else {
                const key = answer.toLowerCase();
                if (answers.has(key)) {
                    warnings.push({ code: 'answer_duplicate', message: `${where}: same answer as ${answers.get(key)}.`, cat: c, row: r });
                } else {
                    answers.set(key, where);
                }
            }
        });
    });

    return { ok: problems.length === 0, problems, warnings };
}

function safeJson(text, fallback) {
    if (Array.isArray(text)) return text;
    try { return JSON.parse(text ?? ''); } catch { return fallback; }
}

/** A tile is ready when it has both a picture and an answer. */
export const isTileReady = (tile) => !!(tile?.imageId && String(tile.answer ?? '').trim());

/** Every image id a draft uses (unique). */
export function imageIdsOf(draft) {
    const ids = new Set();
    for (const cat of draft?.categories ?? []) {
        for (const tile of cat.tiles ?? []) if (tile?.imageId) ids.add(tile.imageId);
    }
    return [...ids];
}

/**
 * Counts for the boards table / dashboard.
 * @param {object} draft
 * @param {Map<string, {rights_status: string}>} imagesById
 */
export function boardStats(draft, imagesById = new Map()) {
    let tilesReady = 0;
    let flaggedTiles = 0;
    for (const cat of draft?.categories ?? []) {
        for (const tile of cat.tiles ?? []) {
            if (isTileReady(tile)) tilesReady++;
            if (tile?.imageId && imagesById.get(tile.imageId)?.rights_status === 'flagged') flaggedTiles++;
        }
    }
    return { tilesReady, flaggedTiles };
}

/**
 * Build the snapshot players receive from a board row + its draft.
 * @param {{ board: object, draft: object, rev: number, imagesById: Map<string, object> }} args
 */
export function buildSnapshot({ board, draft, rev, imagesById }) {
    return {
        id: board.id,
        slug: board.slug,
        rev,
        title: board.title,
        emoji: board.emoji,
        description: board.description || '',
        points: [...(draft.points ?? DEFAULT_POINTS)],
        categories: (draft.categories ?? []).map(cat => ({
            title: cat.title,
            tiles: (cat.tiles ?? []).map(tile => {
                const img = tile.imageId ? imagesById.get(tile.imageId) : null;
                return {
                    answer: String(tile.answer ?? '').trim(),
                    image: img ? {
                        url: mediaUrl(img.display_key),
                        thumb: mediaUrl(img.thumb_key),
                        width: img.width,
                        height: img.height,
                    } : null,
                    credit: img ? creditFor(img) : null,
                };
            }),
        })),
    };
}
