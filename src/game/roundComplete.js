// src/game/roundComplete.js
//
// Pure helper for detecting the moment the final board tile is opened for play.
// A tile is "opened" when the GM posts its question, regardless of whether
// points were awarded. Extracted so it can be unit-tested without DOM or RTDB.

const BOARD_TILE_COUNT = 25; // 5 categories × 5 tiles

/**
 * Returns true when the incoming board snapshot represents the live 24→25
 * opened-tile transition, i.e. exactly one new tile just had its question
 * posted (opened:true) and the board now has all 25 questions started.
 *
 * isFirstFire must be true on the first board-listener call so that
 * reconnecting to an already-complete board never retriggles the celebration.
 *
 * @param {object}  prevCache    The boardCache from the previous listener call
 * @param {object}  newCache     The incoming snapshot (snap.val() || {})
 * @param {boolean} isFirstFire  Pass true only on the very first listener call
 * @returns {boolean}
 */
export function isBoardJustCompleted(prevCache, newCache, isFirstFire) {
    if (isFirstFire) return false;
    const prevOpened = Object.values(prevCache).filter(t => t?.opened === true).length;
    if (prevOpened !== BOARD_TILE_COUNT - 1) return false;
    const newOpened = Object.values(newCache).filter(t => t?.opened === true).length;
    return newOpened >= BOARD_TILE_COUNT;
}
