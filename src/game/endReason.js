// src/game/endReason.js
//
// Pure helper for computing pt_game_ended.end_reason.
//
// Tile resolved-state logic (from the RTDB board tree):
//   opened: false              → tile was never played
//   opened: true, answered: false  → question was posted; resolved unless this
//                                    tile IS the currently active question
//   opened: true, answered: true   → points were awarded; always resolved

/**
 * Determine whether a game ended with all tiles played through or ended early.
 *
 * A tile counts as resolved when:
 *   - It has been opened (a question was posted for it), AND
 *   - It is not the tile currently mid-play at End Game time.
 *
 * A tile that was opened, had its answer shown, and was returned to the board
 * without awarding points still counts as resolved (opened: true, answered: false,
 * no active question). A tile that the GM abandoned mid-swirl does not
 * (opened: true, answered: false, AND its id matches activeQuestionId).
 *
 * A tile with answered: true is always resolved, even if the question result
 * is still on-screen when End Game is clicked.
 *
 * @param {Array<{id: string, opened?: boolean, answered?: boolean}>} tiles
 *   Snapshot of all board tiles (Object.values of boardCache).
 * @param {string|null} activeQuestionId
 *   The id of the tile whose question is currently displayed, or null.
 * @returns {'completed'|'early'}
 */
export function computeEndReason(tiles, activeQuestionId) {
    if (!tiles.length) return 'early';

    const allResolved = tiles.every((t) => {
        if (!t.opened) return false;   // never played
        if (t.answered) return true;   // points awarded → always resolved

        // opened but not awarded: resolved only when no active question for this tile
        return !(activeQuestionId && t.id === activeQuestionId);
    });

    return allResolved ? 'completed' : 'early';
}
