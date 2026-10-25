// tests/unit/roundComplete.test.mjs
//
// Unit tests for isBoardJustCompleted (src/game/roundComplete.js).
//
// After Checkpoint 2 the function tracks opened tiles — any tile where a question
// was started (opened:true), regardless of whether points were awarded. A tile
// with opened:true but answered:false counts the same as one with both true.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBoardJustCompleted } from '../../src/game/roundComplete.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a 25-tile cache where the first `n` tiles have opened:true. */
function openedN(n, totalCount = 25) {
    const cache = {};
    for (let i = 0; i < totalCount; i++) {
        const id = `tile-${i}`;
        cache[id] = { id, opened: i < n, answered: false };
    }
    return cache;
}

/** Like openedN but the opened tiles also carry answered:true (points awarded). */
function openedAndAnsweredN(n, totalCount = 25) {
    const cache = {};
    for (let i = 0; i < totalCount; i++) {
        const id = `tile-${i}`;
        const played = i < n;
        cache[id] = { id, opened: played, answered: played };
    }
    return cache;
}

/** All 25 tiles have answered:true but opened:false (impossible in a real game). */
function answeredWithoutOpenedN(n) {
    const cache = {};
    for (let i = 0; i < 25; i++) {
        const id = `tile-${i}`;
        cache[id] = { id, opened: false, answered: i < n };
    }
    return cache;
}

// ---------------------------------------------------------------------------
// 1. Initial-fire guard: full board on reconnect must not trigger
// ---------------------------------------------------------------------------
test('returns false on the very first listener call even when all 25 tiles are opened', () => {
    const full = openedN(25);
    assert.equal(isBoardJustCompleted({}, full, true), false);
});

// ---------------------------------------------------------------------------
// 2. Correct 24→25 opened transition triggers
// ---------------------------------------------------------------------------
test('returns true when exactly the 24th→25th tile becomes opened', () => {
    const prev = openedN(24);
    const next = openedN(25);
    assert.equal(isBoardJustCompleted(prev, next, false), true);
});

// ---------------------------------------------------------------------------
// 3. Board was already at 25 opened before this fire — no trigger
// ---------------------------------------------------------------------------
test('returns false when board already had 25 opened tiles (no new transition)', () => {
    const full = openedN(25);
    assert.equal(isBoardJustCompleted(full, full, false), false);
});

// ---------------------------------------------------------------------------
// 4. 23→24 transition — not the last tile, must not trigger
// ---------------------------------------------------------------------------
test('returns false on 23→24 opened transition', () => {
    const prev = openedN(23);
    const next = openedN(24);
    assert.equal(isBoardJustCompleted(prev, next, false), false);
});

// ---------------------------------------------------------------------------
// 5. 0→1 (first tile played) — must not trigger
// ---------------------------------------------------------------------------
test('returns false when the very first tile is opened', () => {
    const prev = openedN(0);
    const next = openedN(1);
    assert.equal(isBoardJustCompleted(prev, next, false), false);
});

// ---------------------------------------------------------------------------
// 6. Empty caches — must not trigger
// ---------------------------------------------------------------------------
test('returns false when both caches are empty', () => {
    assert.equal(isBoardJustCompleted({}, {}, false), false);
});

// ---------------------------------------------------------------------------
// 7. prevCache empty, newCache has 25 opened, isFirstFire=false —
//    prev count (0) ≠ 24 so this is NOT a 24→25 transition; must not trigger.
// ---------------------------------------------------------------------------
test('returns false when prev cache is empty and new cache has 25 opened (not a 24→25 transition)', () => {
    const full = openedN(25);
    assert.equal(isBoardJustCompleted({}, full, false), false);
});

// ---------------------------------------------------------------------------
// 8. Pure function — no shared state between calls
// ---------------------------------------------------------------------------
test('is stateless: consecutive calls return consistent results', () => {
    const at24 = openedN(24);
    const at25 = openedN(25);
    const at23 = openedN(23);

    assert.equal(isBoardJustCompleted(at24, at25, false), true);
    assert.equal(isBoardJustCompleted(at23, at24, false), false);
    assert.equal(isBoardJustCompleted(at24, at25, false), true);
});

// ---------------------------------------------------------------------------
// 9. opened:true without answered:true counts as played
//    (question posted but no points awarded yet — e.g. the 25th question is
//    still on screen when the board listener fires)
// ---------------------------------------------------------------------------
test('counts opened:true tiles even when answered is false', () => {
    const prev = openedN(24);   // answered:false on all tiles
    const next = openedN(25);
    assert.equal(isBoardJustCompleted(prev, next, false), true);
});

// ---------------------------------------------------------------------------
// 10. Mix of awarded and unawarded tiles — only opened count matters
// ---------------------------------------------------------------------------
test('returns true on 24→25 transition regardless of how many tiles were awarded', () => {
    // 12 tiles: opened+answered, 12 tiles: opened-only, 1 tile: not yet opened
    const prev = {};
    for (let i = 0; i < 12; i++) prev[`tile-${i}`] = { id: `tile-${i}`, opened: true, answered: true };
    for (let i = 12; i < 24; i++) prev[`tile-${i}`] = { id: `tile-${i}`, opened: true, answered: false };
    prev['tile-24'] = { id: 'tile-24', opened: false, answered: false };

    const next = { ...prev, 'tile-24': { id: 'tile-24', opened: true, answered: false } };
    assert.equal(isBoardJustCompleted(prev, next, false), true);
});

// ---------------------------------------------------------------------------
// 11. answered:true without opened:true does NOT count toward completion
// ---------------------------------------------------------------------------
test('returns false when tiles have answered:true but opened:false (guard against wrong flag)', () => {
    const prev = answeredWithoutOpenedN(24);
    const next = answeredWithoutOpenedN(25);
    assert.equal(isBoardJustCompleted(prev, next, false), false);
});

// ---------------------------------------------------------------------------
// 12. All opened AND all answered — still detects the transition correctly
// ---------------------------------------------------------------------------
test('returns true on 24→25 transition when all tiles are both opened and answered', () => {
    const prev = openedAndAnsweredN(24);
    const next = openedAndAnsweredN(25);
    assert.equal(isBoardJustCompleted(prev, next, false), true);
});

// ---------------------------------------------------------------------------
// 13. isFirstFire=true always suppresses, regardless of opened/answered mix
// ---------------------------------------------------------------------------
test('isFirstFire=true always returns false, even for a fully awarded board', () => {
    const full = openedAndAnsweredN(25);
    assert.equal(isBoardJustCompleted({}, full, true), false);
    assert.equal(isBoardJustCompleted(full, full, true), false);
});
