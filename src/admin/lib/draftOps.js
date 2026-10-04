// src/admin/lib/draftOps.js
//
// Pure, immutable edits on a board draft (shape: src/shared/boards.js).
// The editor applies these and re-renders; unit-tested in
// tests/unit/draftOps.test.mjs. Points always belong to the ROW, so moving a
// tile from the 500 slot to the 300 slot makes it worth 300.

const copy = (draft) => structuredClone(draft);
const inRange = (i, n) => Number.isInteger(i) && i >= 0 && i < n;

/** Move a tile within its category (others shift), e.g. 500 → 300. */
export function moveTile(draft, cat, from, to) {
    const d = copy(draft);
    const tiles = d.categories[cat]?.tiles;
    if (!tiles || !inRange(from, tiles.length) || !inRange(to, tiles.length) || from === to) return d;
    const [tile] = tiles.splice(from, 1);
    tiles.splice(to, 0, tile);
    return d;
}

/** Swap two tiles anywhere on the board (used for cross-category drags). */
export function swapTiles(draft, a, b) {
    const d = copy(draft);
    const ta = d.categories[a.cat]?.tiles;
    const tb = d.categories[b.cat]?.tiles;
    if (!ta || !tb || !inRange(a.row, ta.length) || !inRange(b.row, tb.length)) return d;
    [ta[a.row], tb[b.row]] = [tb[b.row], ta[a.row]];
    return d;
}

/** Move a whole category (column) — with all its tiles — to another position. */
export function moveCategory(draft, from, to) {
    const d = copy(draft);
    const cats = d.categories;
    if (!inRange(from, cats.length) || !inRange(to, cats.length) || from === to) return d;
    const [cat] = cats.splice(from, 1);
    cats.splice(to, 0, cat);
    return d;
}

/** Merge fields into one tile. */
export function setTile(draft, cat, row, patch) {
    const d = copy(draft);
    const tile = d.categories[cat]?.tiles?.[row];
    if (tile) Object.assign(tile, patch);
    return d;
}

export function setCategoryTitle(draft, cat, title) {
    const d = copy(draft);
    if (d.categories[cat]) d.categories[cat].title = title;
    return d;
}

/** Same draft? (cheap structural compare for "anything to save?") */
export const sameDraft = (a, b) => JSON.stringify(a) === JSON.stringify(b);
