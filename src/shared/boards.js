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

import { creditFor } from './rights.js';

export const CATEGORY_COUNT = 5;
export const TILES_PER_CATEGORY = 5;
export const DEFAULT_POINTS = [100, 200, 300, 400, 500];

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
