// tests/unit/draftOps.test.mjs — src/admin/lib/draftOps.js (editor moves)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveTile, swapTiles, moveCategory, setTile, setCategoryTitle, sameDraft } from '../../src/admin/lib/draftOps.js';
import { emptyDraft } from '../../src/shared/boards.js';

function labeled() {
    const d = emptyDraft();
    d.categories.forEach((cat, c) => {
        cat.title = `C${c}`;
        cat.tiles.forEach((t, r) => { t.answer = `${c}${r}`; });
    });
    return d;
}
const answers = (d, c) => d.categories[c].tiles.map(t => t.answer);

test('moveTile inserts and shifts within a category (500 → 300)', () => {
    const d = labeled();
    const moved = moveTile(d, 1, 4, 2);
    assert.deepEqual(answers(moved, 1), ['10', '11', '14', '12', '13']);
    assert.deepEqual(answers(d, 1), ['10', '11', '12', '13', '14'], 'original untouched');
    assert.deepEqual(answers(moveTile(d, 1, 0, 4), 1), ['11', '12', '13', '14', '10']);
});

test('moveTile ignores out-of-range or no-op moves', () => {
    const d = labeled();
    assert.ok(sameDraft(moveTile(d, 1, 2, 2), d));
    assert.ok(sameDraft(moveTile(d, 1, -1, 2), d));
    assert.ok(sameDraft(moveTile(d, 1, 0, 5), d));
    assert.ok(sameDraft(moveTile(d, 9, 0, 1), d));
});

test('swapTiles swaps across categories and keeps 5 per column', () => {
    const d = labeled();
    const s = swapTiles(d, { cat: 0, row: 4 }, { cat: 3, row: 1 });
    assert.equal(s.categories[0].tiles[4].answer, '31');
    assert.equal(s.categories[3].tiles[1].answer, '04');
    assert.ok(s.categories.every(c => c.tiles.length === 5));
    assert.ok(sameDraft(swapTiles(d, { cat: 0, row: 9 }, { cat: 1, row: 0 }), d));
});

test('moveCategory moves a whole column with its tiles', () => {
    const d = labeled();
    const m = moveCategory(d, 0, 2);
    assert.deepEqual(m.categories.map(c => c.title), ['C1', 'C2', 'C0', 'C3', 'C4']);
    assert.deepEqual(answers(m, 2), ['00', '01', '02', '03', '04']);
    assert.ok(sameDraft(moveCategory(d, 0, 5), d));
});

test('setTile / setCategoryTitle are immutable', () => {
    const d = labeled();
    const t = setTile(d, 2, 3, { answer: 'New', imageId: 'img_0000000000000001' });
    assert.equal(t.categories[2].tiles[3].answer, 'New');
    assert.equal(t.categories[2].tiles[3].imageId, 'img_0000000000000001');
    assert.equal(d.categories[2].tiles[3].answer, '23');
    assert.equal(setCategoryTitle(d, 4, 'Renamed').categories[4].title, 'Renamed');
    assert.equal(d.categories[4].title, 'C4');
});
