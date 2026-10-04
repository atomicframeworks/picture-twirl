// src/game/createGame.js
//
// Creates a new game in ONE write: the game node, the host's participant row
// and (optionally) the chosen Board's published snapshot (fetched from
// /api/boards/:id — see data/boardsApi.js), materialized as live tiles.
// The game lives in its GameRoom (worker/rooms/); the room exists exactly
// when this node does, so there's no separate public index any more.
//
// -----------------------------------------------------------------------------
// Data written (simplified):
// - /games/{id}:
//     hostUid, isPublic, createdAt, title, gmName,
//     settings: { boardId, boardRev, teamsEnabled },
//     state: { phase: 'lobby' },
//     teams: { A: {name}, B: {name} },
//     scores: { A:0, B:0 }
// - /games/{id}/participants/{uid}:
//     displayName, team, joinedAt (joinedAt set only once)
// - /games/{id}/board/{tileId}:
//     id, col, row, category, imageUrl, answer, value,
//     opened, answered, answeredBy, awardedPoints, locked, lastActionAt
//
// Rules (worker/rooms/roomCore.js): only the creator may create a game in an
// empty room, and becomes its host (hostUid); the host may write anything;
// players only their own participant row and their buzzes. Players never
// receive answers or upcoming pictures (board/*/answer, board/*/imageUrl).
//
// Notes:
// - Boards come from the API as snapshots; data/boardsApi.js toBoardSet()
//   converts one into the { columns: [{ title, rows: [...] }] } shape that
//   buildBoardFromSet() below materializes.
//
// -----------------------------------------------------------------------------

import { rtdb, getCurrentUser } from '../realtime/client.js';
import { ref, set, serverTimestamp } from '../realtime/db.js';
import { getBoard, toBoardSet } from '../data/boardsApi.js';
import { LIMITS, TEAM } from '../config.js';
import * as P from '../data/paths.js';

/**
 * Fetch a published board and turn it into a live-game board.
 * Used by game creation and by Play Again (renderRoundSetup.js).
 * @param {string} boardId - board id or slug
 * @param {any} nowTimestamp - serverTimestamp() sentinel
 * @returns {Promise<{ board: Record<string, any>, boardMeta: { boardId: string, boardRev: number } }>}
 */
export async function loadBoardForGame(boardId, nowTimestamp) {
    const snapshot = await getBoard(boardId);
    return {
        board: buildBoardFromSet(toBoardSet(snapshot), nowTimestamp),
        boardMeta: { boardId: snapshot.slug, boardRev: snapshot.rev },
    };
}

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
 * @param {object} set - A board in shape A or B (usually toBoardSet(snapshot))
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
 *   boardId: string,                  // board id or slug (published)
 *   teamA?: string,
 *   teamB?: string,
 *   gmName?: string,
 *   title?: string,
 *   teamsEnabled?: boolean,
 *   materializeBoard?: boolean        // default true
 * }} opts
 */
export async function createGameShell(
    gameId,
    {
        boardId,
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
    if (!boardId) throw new Error('No board selected');

    // sanitize
    const safeTitle = (title || '').slice(0, LIMITS.GAME_TITLE);
    const safeGM = (gmName || `GM-${uid.slice(-4)}`).slice(0, LIMITS.DISPLAY_NAME);
    const safeTeamA = (teamA || 'Team A').slice(0, LIMITS.TEAM_NAME);
    const safeTeamB = (teamB || 'Team B').slice(0, LIMITS.TEAM_NAME);
    const teamsOn = !!teamsEnabled;

    const now = serverTimestamp();

    // Fetch the board BEFORE writing anything, so a network/API failure can't
    // leave a half-created game behind.
    const { board, boardMeta } = await loadBoardForGame(boardId, now);

    const gameData = {
        hostUid: uid,
        isPublic: false,
        createdAt: now,
        title: safeTitle,
        gmName: safeGM,
        settings: { boardId: boardMeta.boardId, boardRev: boardMeta.boardRev, teamsEnabled: teamsOn },
        state: { phase: 'lobby' },
        teams: { A: { name: safeTeamA }, B: { name: safeTeamB } },
        scores: { A: 0, B: 0 },
        participants: { [uid]: { displayName: safeGM, team: TEAM.NONE, joinedAt: now, isGM: true } },
        ...(materializeBoard ? { board } : {}),
    };

    // ONE write creates the whole game, so a failure can't leave half a game
    // behind (AUDIT M8). The room accepts it only if it's empty and the code
    // was reserved for us (or not at all).
    await set(ref(rtdb, P.game(gameId)), gameData);
}


export { buildBoardFromSet };
