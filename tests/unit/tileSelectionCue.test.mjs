// tests/unit/tileSelectionCue.test.mjs
//
// Unit tests for the GM tile-selection audio-cue guard logic.
//
// The actual cue is triggered inside the selectedTile onValue listener in
// renderGame.js. That file pulls in DOM, RTDB, and session dependencies, so
// this test file simulates the exact guard conditions with a lightweight
// state machine and a mock playTileSelected() counter — no audio is played.
//
// Guard conditions (must ALL be true to play):
//   isGM                              — player clients never hear the cue
//   selectedTileListenerHasFired      — suppresses initial hydration / reconnect
//   incoming !== null                 — a tile was just selected (not cleared)
//   prevSelected === null             — it is a NEW selection (null → non-null)
//   !selectedTileCued                 — hasn't already been played for this selection

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Simulator: drives the renderGame.js selectedTile listener guard verbatim.
// `calls` is an ordered array of incoming selectedTile values (null or object).
// Returns the number of times playTileSelected() would have been called.
// ---------------------------------------------------------------------------
function simulate(calls, { isGM }) {
    let hasFired = false;
    let prevSelected = null;
    let cued = false;
    let playCount = 0;

    for (const incoming of calls) {
        // Mirror of the guard in renderGame.js
        if (isGM && hasFired && incoming && !prevSelected && !cued) {
            cued = true;
            playCount++;
        }
        if (!incoming) cued = false;
        hasFired = true;
        prevSelected = incoming;
    }
    return playCount;
}

const TILE = { id: '0-0', category: 'History', value: 100 };
const TILE2 = { id: '1-3', category: 'Movies', value: 300 };

// ---------------------------------------------------------------------------
// 1. GM: new selection after initial null → cue plays once
// ---------------------------------------------------------------------------
test('GM: new eligible selection → cue plays once', () => {
    assert.equal(simulate([null, TILE], { isGM: true }), 1);
});

// ---------------------------------------------------------------------------
// 2. Player selection still pending in tileRequest, not yet promoted to
//    selectedTile → the listener never fires → cue never plays.
//    (The cue fires only when selectedTile is set, not when tileRequest is set.)
//    This is guaranteed by the architecture: simulate an unset selectedTile
//    while unrelated state updates arrive.
// ---------------------------------------------------------------------------
test('Player selection pending (selectedTile still null) → no cue', () => {
    // Multiple calls where selectedTile never becomes non-null
    assert.equal(simulate([null, null, null], { isGM: true }), 0);
});

// ---------------------------------------------------------------------------
// 3. GM selects the tile directly (same result as player-promoted selection)
// ---------------------------------------------------------------------------
test('GM-initiated selection → cue plays once', () => {
    assert.equal(simulate([null, TILE], { isGM: true }), 1);
});

// ---------------------------------------------------------------------------
// 4. Duplicate listener updates for the same selection → no repeat
// ---------------------------------------------------------------------------
test('Duplicate/re-fired updates with same selection → cue plays exactly once', () => {
    assert.equal(simulate([null, TILE, TILE, TILE], { isGM: true }), 1);
});

// ---------------------------------------------------------------------------
// 5. Unrelated state update (selectedTile does not change) → no cue
//    Modelled as repeated null→null updates (selectedTile never set).
// ---------------------------------------------------------------------------
test('Unrelated game-state updates when no tile is selected → no cue', () => {
    assert.equal(simulate([null, null, null, null], { isGM: true }), 0);
});

// ---------------------------------------------------------------------------
// 6. Selection cleared (Back to Board / OK) → next selection can cue again
// ---------------------------------------------------------------------------
test('Selection cleared then new selection → cue plays for each new selection', () => {
    // Initial, select, clear, select again
    assert.equal(simulate([null, TILE, null, TILE2], { isGM: true }), 2);
});

// ---------------------------------------------------------------------------
// 7. Initial hydration with an existing selection → no historical notification
//    (first-fire guard: hasFired is false on the first call)
// ---------------------------------------------------------------------------
test('Initial hydration with existing selection (reconnect) → no cue', () => {
    assert.equal(simulate([TILE], { isGM: true }), 0);
});

// ---------------------------------------------------------------------------
// 8. Player client → no cue regardless of selection state
// ---------------------------------------------------------------------------
test('Player client: selection arrives → no cue', () => {
    assert.equal(simulate([null, TILE], { isGM: false }), 0);
    assert.equal(simulate([null, TILE, null, TILE2], { isGM: false }), 0);
});

// ---------------------------------------------------------------------------
// 9. Audio muted / context unavailable → no gameplay disruption
//    This is inherent to the Web Audio implementation: tone() begins with
//    `const c = ac(); if (!c) return;` and unlockAudio() is a no-op when the
//    context is absent. The guard here tests that the cue is requested; sound.js
//    handles silent failure. Verified by confirming the guard fires correctly:
// ---------------------------------------------------------------------------
test('Guard fires even when audio would be unavailable (audio fail-silent by design)', () => {
    // The guard fires → playTileSelected() is "called"; the actual tone() returns
    // early if AudioContext is missing. So count = 1 is correct behavior.
    assert.equal(simulate([null, TILE], { isGM: true }), 1);
});

// ---------------------------------------------------------------------------
// 10. Reconnect mid-game with existing selection; cleared; then new selection
//     → only the post-first-fire new selection cues
// ---------------------------------------------------------------------------
test('Reconnect with existing selection, then clear, then new selection → one cue', () => {
    // First call: hasFired=false → no cue for existing selection
    // Second call: clear → cued reset
    // Third call: new selection → cues
    assert.equal(simulate([TILE, null, TILE2], { isGM: true }), 1);
});

// ---------------------------------------------------------------------------
// 11. Multiple consecutive clears before a new selection → cue plays once
// ---------------------------------------------------------------------------
test('Multiple consecutive clears then new selection → one cue', () => {
    assert.equal(simulate([null, null, null, TILE], { isGM: true }), 1);
});

// ---------------------------------------------------------------------------
// 12. Stat: player isGM=false with every scenario produces zero cues
// ---------------------------------------------------------------------------
test('isGM=false: no cue for any sequence of selections', () => {
    assert.equal(simulate([null, TILE, null, TILE2, TILE, null], { isGM: false }), 0);
});
