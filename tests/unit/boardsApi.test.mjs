// tests/unit/boardsApi.test.mjs — snapshot → live-game board
// (src/data/boardsApi.js toBoardSet + game/createGame.js buildBoardFromSet)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBoardSet } from '../../src/data/boardsApi.js';
import { buildBoardFromSet } from '../../src/game/createGame.js';

function snapshot() {
    return {
        id: 'brd_1', slug: 'pop-icons', rev: 3, title: 'Pop Culture Icons', emoji: '🎤',
        points: [100, 200, 300, 400, 500],
        categories: Array.from({ length: 5 }, (_, c) => ({
            title: `Cat ${c}`,
            tiles: Array.from({ length: 5 }, (_, r) => ({
                answer: `A${c}${r}`,
                image: { url: `/media/display/${c}${r}.webp`, thumb: '', width: 10, height: 10 },
                credit: null,
            })),
        })),
    };
}

test('toBoardSet maps categories → columns, tiles → rows with points', () => {
    const set = toBoardSet(snapshot());
    assert.equal(set.id, 'pop-icons');
    assert.equal(set.columns.length, 5);
    assert.deepEqual(set.columns[2].rows[3], { imageUrl: '/media/display/23.webp', answer: 'A23', value: 400 });
});

test('toBoardSet tolerates missing pictures and points', () => {
    const snap = snapshot();
    delete snap.points;
    snap.categories[0].tiles[0].image = null;
    const set = toBoardSet(snap);
    assert.equal(set.columns[0].rows[0].imageUrl, '');
    assert.equal(set.columns[0].rows[4].value, 500);
});

test('buildBoardFromSet(toBoardSet(snapshot)) gives the 25 live tiles keyed "col-row"', () => {
    const now = { '.sv': 'timestamp' };
    const board = buildBoardFromSet(toBoardSet(snapshot()), now);
    assert.equal(Object.keys(board).length, 25);
    assert.deepEqual(board['4-0'], {
        id: '4-0', col: 4, row: 0, category: 'Cat 4', imageUrl: '/media/display/40.webp', answer: 'A40', value: 100,
        opened: false, answered: false, answeredBy: null, awardedPoints: 0, locked: false, lastActionAt: now,
    });
});
