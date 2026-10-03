// src/data/boardsApi.js
//
// The game's read-only view of Boards — published content served by the
// Worker from D1 (worker/routes/public.js; PROPOSAL.md §6). Replaces the old
// bundled predefinedGames.js.

async function getJson(path) {
    const res = await fetch(path, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
    return res.json();
}

/** Published boards for the pickers: [{ id, slug, title, emoji, description, rev }]. */
export async function listBoards() {
    const { boards } = await getJson('/api/boards');
    return Array.isArray(boards) ? boards : [];
}

/** One board's published snapshot (shape: src/shared/boards.js buildSnapshot). */
export function getBoard(idOrSlug) {
    return getJson(`/api/boards/${encodeURIComponent(idOrSlug)}`);
}

/**
 * Snapshot → the { columns: [{ title, rows: [{ imageUrl, answer, value }] }] }
 * shape buildBoardFromSet() (game/createGame.js) materializes into a live game.
 */
export function toBoardSet(snapshot) {
    const points = snapshot.points || [];
    return {
        id: snapshot.slug,
        title: snapshot.title,
        columns: (snapshot.categories || []).map(cat => ({
            title: cat.title,
            rows: (cat.tiles || []).map((tile, r) => ({
                imageUrl: tile.image?.url || '',
                answer: tile.answer || '',
                value: points[r] ?? (r + 1) * 100,
            })),
        })),
    };
}
