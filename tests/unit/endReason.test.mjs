// tests/unit/endReason.test.mjs
//
// Regression tests for computeEndReason (src/game/endReason.js).
//
// Each test exercises a distinct scenario to guard against regressions
// in the completion-classification logic for pt_game_ended.end_reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEndReason } from '../../src/game/endReason.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tile(id, { opened = false, answered = false } = {}) {
    return { id, opened, answered };
}

// ---------------------------------------------------------------------------
// 1. All tiles awarded → completed
// ---------------------------------------------------------------------------
test('completed when every tile has been opened and awarded', () => {
    const tiles = [
        tile('0-0', { opened: true, answered: true }),
        tile('0-1', { opened: true, answered: true }),
        tile('1-0', { opened: true, answered: true }),
    ];
    assert.equal(computeEndReason(tiles, null), 'completed');
});

// ---------------------------------------------------------------------------
// 2. All tiles played through, some without points → completed
// (The primary regression case: tile answered by showing but team didn't score)
// ---------------------------------------------------------------------------
test('completed when every tile is opened, even if some were not awarded', () => {
    const tiles = [
        tile('0-0', { opened: true, answered: true }),
        tile('0-1', { opened: true, answered: false }),  // played, no award
        tile('1-0', { opened: true, answered: true }),
        tile('1-1', { opened: true, answered: false }),  // played, no award
    ];
    assert.equal(computeEndReason(tiles, null), 'completed');
});

// ---------------------------------------------------------------------------
// 3. All tiles played, none awarded (e.g. nobody buzzes on any tile) → completed
// ---------------------------------------------------------------------------
test('completed when every tile is opened and none were awarded', () => {
    const tiles = [
        tile('0-0', { opened: true, answered: false }),
        tile('0-1', { opened: true, answered: false }),
    ];
    assert.equal(computeEndReason(tiles, null), 'completed');
});

// ---------------------------------------------------------------------------
// 4. Some tiles never played → early
// ---------------------------------------------------------------------------
test('early when some tiles were never opened', () => {
    const tiles = [
        tile('0-0', { opened: true, answered: true }),
        tile('0-1', { opened: false, answered: false }),  // never played
    ];
    assert.equal(computeEndReason(tiles, null), 'early');
});

// ---------------------------------------------------------------------------
// 5. No tiles at all (empty boardCache) → early
// ---------------------------------------------------------------------------
test('early when the tile list is empty', () => {
    assert.equal(computeEndReason([], null), 'early');
});

// ---------------------------------------------------------------------------
// 6. Final tile started but abandoned mid-play → early
// (opened: true but it IS the active question — not yet resolved)
// ---------------------------------------------------------------------------
test('early when one tile is the currently active question (mid-play)', () => {
    const tiles = [
        tile('0-0', { opened: true, answered: true }),
        tile('0-1', { opened: true, answered: true }),
        tile('0-2', { opened: true, answered: false }),  // mid-swirl
    ];
    assert.equal(computeEndReason(tiles, '0-2'), 'early');
});

// ---------------------------------------------------------------------------
// 7. Active question is on a tile that was awarded (result still on-screen) →
//    completed (awarded: true takes precedence over the mid-play check)
// ---------------------------------------------------------------------------
test('completed when active question tile is awarded (GM ended without Back to Board)', () => {
    const tiles = [
        tile('0-0', { opened: true, answered: true }),
        tile('0-1', { opened: true, answered: true }),
        tile('0-2', { opened: true, answered: true }),  // awarded, result still showing
    ];
    // currentQuestion is still set for tile '0-2' (award happened but GM went End Game
    // instead of Back to Board — answered: true should win)
    assert.equal(computeEndReason(tiles, '0-2'), 'completed');
});

// ---------------------------------------------------------------------------
// 8. Mix: some played, one never opened, active question on opened tile → early
// ---------------------------------------------------------------------------
test('early when unplayed tiles remain and there is also an active question', () => {
    const tiles = [
        tile('0-0', { opened: true, answered: true }),
        tile('0-1', { opened: false, answered: false }),  // never played
        tile('0-2', { opened: true, answered: false }),   // active
    ];
    assert.equal(computeEndReason(tiles, '0-2'), 'early');
});

// ---------------------------------------------------------------------------
// 9. Play Again — same helper, board classified independently of previous round
//    (round-2 tiles all resolved, null active question)
// ---------------------------------------------------------------------------
test('completed for a Play Again board when all tiles were resolved in the second round', () => {
    // Simulate a fresh round-2 board: same tile-id keyspace, all resolved
    const tiles = [
        tile('0-0', { opened: true, answered: true }),
        tile('0-1', { opened: true, answered: false }),  // played, no award
        tile('1-0', { opened: true, answered: true }),
        tile('1-1', { opened: true, answered: true }),
        tile('2-0', { opened: true, answered: false }),  // played, no award
    ];
    assert.equal(computeEndReason(tiles, null), 'completed');
});

// ---------------------------------------------------------------------------
// 10. Play Again — second round ended early (one tile never touched)
// ---------------------------------------------------------------------------
test('early for a Play Again board when some tiles were skipped in the second round', () => {
    const tiles = [
        tile('0-0', { opened: true, answered: true }),
        tile('0-1', { opened: false, answered: false }),  // never played in round 2
        tile('1-0', { opened: true, answered: true }),
    ];
    assert.equal(computeEndReason(tiles, null), 'early');
});

// ---------------------------------------------------------------------------
// 11. Normal round and Play Again round both produce consistent results via
//     the same helper (no state bleeds between calls)
// ---------------------------------------------------------------------------
test('helper is stateless: consecutive calls for different rounds return correct results', () => {
    // Round 1 ended early
    const round1 = [
        tile('0-0', { opened: true, answered: true }),
        tile('0-1', { opened: false, answered: false }),
    ];
    assert.equal(computeEndReason(round1, null), 'early');

    // Round 2 (Play Again) completed
    const round2 = [
        tile('0-0', { opened: true, answered: true }),
        tile('0-1', { opened: true, answered: false }),
    ];
    assert.equal(computeEndReason(round2, null), 'completed');
});

// ---------------------------------------------------------------------------
// 12. activeQuestionId that does not match any tile is ignored safely
// ---------------------------------------------------------------------------
test('completed when activeQuestionId refers to a tile not in the board list', () => {
    const tiles = [
        tile('0-0', { opened: true, answered: true }),
        tile('0-1', { opened: true, answered: true }),
    ];
    // Stale / mismatched id — should not affect result
    assert.equal(computeEndReason(tiles, 'no-such-tile'), 'completed');
});
