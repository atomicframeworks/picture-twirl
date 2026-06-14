// src/game/createGame.js
//
// Creates a new game shell, upserts the host into /participants,
// writes a public existence flag at /gameIndex/{gameId}, and
// (optionally) materializes a stable board snapshot from a predefined set.
//
// -----------------------------------------------------------------------------
// Data written (simplified):
// - /games/{id}:
//     hostUid, isPublic, createdAt, title, gmName,
//     settings: { setId, teamsEnabled },
//     state: { phase: 'lobby' },
//     teams: { A: {name}, B: {name} },
//     scores: { A:0, B:0 }
// - /gameIndex/{id}: true     (public, read-only for players)
// - /games/{id}/participants/{uid}:
//     displayName, team, joinedAt (joinedAt set only once)
// - /games/{id}/board/{tileId}:
//     id, col, row, category, imageUrl, answer, value,
//     opened, answered, answeredBy, awardedPoints, locked, lastActionAt
// - /games/{id}/buzzing: { queue: null, active: null }
//
// Rules expectation (high-level):
// - Only host (auth.uid == games/{id}.hostUid) can write /games/{id} and /gameIndex/{id}.
// - joinedAt is immutable after first write.
// - Players can read /games/{id}/board and push to /games/{id}/buzzing/queue,
//   but only the host adjudicates /board/* state and /buzzing/active.
//
// Notes:
// - This file assumes a `predefinedGames` module in the same app that exports an
//   array of game sets: [{ id, columns: [{ title, rows: [{ imageUrl?, image?, answer?, value? }] }] }]
//   Adjust `buildBoardFromSet()` mapping below if your shape is different.
//
// -----------------------------------------------------------------------------

import { rtdb, getCurrentUser } from '../firebase.js';
import { ref, set, update, serverTimestamp, get } from 'firebase/database';
import { predefinedGames } from '../predefinedGames.js';
import { LIMITS, TEAM } from '../config.js';
import * as P from '../data/paths.js';

/**
 * Build a stable board snapshot for a selected set.
 * Supports TWO input shapes:
 *  A) { columns: [{ title, rows: [{ imageUrl?, image?, answer?, value? }] }] }
 *  B) { categories: string[], board: Tile[][] }  // <- your current structure
 *     - categories[c] names the column
 *     - board[r][c] is the tile at row r, column c
 *
 * Output tiles are keyed by "c-r" (e.g., "0-3") and include:
 *   id, col, row, category, imageUrl, answer, value
 * plus live-state fields: opened, answered, answeredBy, awardedPoints, locked, lastActionAt
 *
 * @param {object} set - One entry from predefinedGames (matching the selected setId)
 * @param {any} nowTimestamp - serverTimestamp() sentinel (passed-through for consistency)
 * @returns {Record<string, any>} board object keyed by tileId e.g. "0-0"
 */
function buildBoardFromSet(set, nowTimestamp) {
    const board = {};

    // -------------------------
    // Shape A: columns/rows
    // -------------------------
    if (Array.isArray(set?.columns)) {
        set.columns.forEach((col, c) => {
            (col.rows || []).forEach((tile, r) => {
                const id = `${c}-${r}`;
                board[id] = {
                    // Content
                    id,
                    col: c,
                    row: r,
                    category: col.title || `Category ${c + 1}`,
                    imageUrl: tile?.imageUrl || tile?.image || '',
                    answer: tile?.answer || '',
                    value: typeof tile?.value === 'number' ? tile.value : (r + 1) * 100,

                    // Live state
                    opened: false,
                    answered: false,
                    answeredBy: null,       // 'teamA' | 'teamB' | `solo:${uid}`
                    awardedPoints: 0,
                    locked: false,
                    lastActionAt: nowTimestamp,
                };
            });
        });
        return board;
    }

    // -------------------------
    // Shape B: categories/board (your current structure)
    //   - categories: string[]  (columns)
    //   - board: Tile[][]       (rows x columns)
    // -------------------------
    const categories = Array.isArray(set?.categories) ? set.categories : null;
    const grid = Array.isArray(set?.board) ? set.board : null;

    if (categories && grid) {
        const numCols = categories.length;
        const numRows = grid.length;

        for (let c = 0; c < numCols; c++) {
            const categoryName = categories[c] || `Category ${c + 1}`;
            for (let r = 0; r < numRows; r++) {
                const cell = Array.isArray(grid[r]) ? grid[r][c] : undefined;
                // Gracefully skip holes (undefined or missing tile)
                if (!cell) continue;

                const id = `${c}-${r}`;
                board[id] = {
                    // Content
                    id,
                    col: c,
                    row: r,
                    category: categoryName,
                    imageUrl: cell.imageUrl || cell.image || '',
                    answer: cell.answer || '',
                    value: typeof cell.value === 'number' ? cell.value : (r + 1) * 100,

                    // Live state
                    opened: false,
                    answered: false,
                    answeredBy: null,
                    awardedPoints: 0,
                    locked: false,
                    lastActionAt: nowTimestamp,
                };
            }
        }
        return board;
    }

    // If neither shape is recognized, throw a helpful error
    throw new Error(
        `Unsupported game set shape for id="${set?.id || 'unknown'}". Expected {columns[]} or {categories[], board[][]}.`
    );
}

/**
 * Creates a new game shell in RTDB and (by default) materializes the board.
 *
 * @param {string} gameId
 * @param {{
 *   setId: string,
 *   teamA?: string,
 *   teamB?: string,
 *   gmName?: string,
 *   title?: string,
 *   teamsEnabled?: boolean,
 *   materializeBoard?: boolean        // default true
 * }} opts
 */
// src/game/createGame.js  (patched createGameShell)

export async function createGameShell(
    gameId,
    {
        setId,
        teamA,
        teamB,
        gmName,
        title,
        teamsEnabled,
        materializeBoard = true,
    } = {}
) {
    const user = getCurrentUser();
    const uid = user?.uid;
    if (!uid) throw new Error('Not signed in');

    // sanitize
    const safeTitle = (title || '').slice(0, LIMITS.GAME_TITLE);
    const safeGM = (gmName || `GM-${uid.slice(-4)}`).slice(0, LIMITS.DISPLAY_NAME);
    const safeTeamA = (teamA || 'Team A').slice(0, LIMITS.TEAM_NAME);
    const safeTeamB = (teamB || 'Team B').slice(0, LIMITS.TEAM_NAME);
    const teamsOn = !!teamsEnabled;

    const now = serverTimestamp();
    const rootRef = ref(rtdb);

    const gameData = {
        hostUid: uid,
        isPublic: false,
        createdAt: now,
        title: safeTitle,
        gmName: safeGM,
        settings: { setId, teamsEnabled: teamsOn },
        state: { phase: 'lobby' },
        teams: { A: { name: safeTeamA }, B: { name: safeTeamB } },
        scores: { A: 0, B: 0 },
    };

    // --- 1) Write parent node and index (no child paths in the same update)
    // Use set() for the parent and update() for the index; order is fine.
    await set(ref(rtdb, `games/${gameId}`), gameData);
    await update(rootRef, { [`gameIndex/${gameId}`]: true });

    // --- 2) Optionally materialize board + buzzing in a separate update
    if (materializeBoard) {
        const set = predefinedGames.find(g => g.id === setId);
        if (!set) throw new Error(`Unknown setId: ${setId}`);

        const board = buildBoardFromSet(set, now);

        await update(rootRef, {
            [`games/${gameId}/board`]: board,
            // Optional: create an empty container so UI sees the node (not required)
            // [`games/${gameId}/buzzQueue`]: null,
        });
    }

    // --- 3) Upsert host participant (preserve joinedAt)
    const meRef = ref(rtdb, P.participant(gameId, uid));
    const existing = await get(meRef);
    if (!existing.exists()) {
        await set(meRef, { displayName: safeGM, team: TEAM.NONE, joinedAt: now });
    } else {
        await update(meRef, { displayName: safeGM, team: TEAM.NONE });
    }
}


// -----------------------------------------------------------------------------
// If you later want to reuse the board materialization elsewhere (e.g. to
// regenerate a board, clone a game, etc.), you can export the helper:
//
// export { buildBoardFromSet };
//
// -----------------------------------------------------------------------------
