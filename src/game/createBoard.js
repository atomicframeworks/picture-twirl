// src/game/createBoard.js
//
// Picture Twirl — Board Builder (controller-friendly)
// -----------------------------------------------------------------------------
// Responsibilities
// - Read the materialized board at /games/{gameId}/board.
// - Render a Jeopardy-style grid: category headers + value tiles.
// - Handle GM tile clicks:
//     1) Clear buzz queue (host-only by rules).
//     2) Set /games/{id}/currentQuestion and /games/{id}/swirlStartTime.
//     3) Mark the tile as opened (NOT answered yet).
// - Be defensive against holes, missing rows, or partial data.
//
// Notes
// - Uses centralized RTDB path builders from data/paths.js
// - Uses imageUrl (not image) for currentQuestion
// - “Answered” tiles render with a ✔ and ignore further clicks
// - “Opened” tiles keep their $ value but add .opened class
// -----------------------------------------------------------------------------

import { rtdb } from '../firebase.js';
import { ref, get } from 'firebase/database';
import * as P from '../data/paths.js';

/**
 * Build the board DOM from /games/{gameId}/board and wire tile clicks.
 * @param {string} gameId
 * @param {Object} options
 * @param {Function} options.onTileClick - Callback for tile clicks
 * @returns {Promise<HTMLDivElement>} <div id="board"> ready to mount
 */
export async function createBoard(gameId, options = {}) {
    const { onTileClick } = options;
    // 1) Fetch tiles snapshot once
    const snap = await get(ref(rtdb, P.board(gameId)));
    const tilesObj = snap.val() || {};

    // Normalize: [{ id, ...tile }]
    const tiles = Object.entries(tilesObj).map(([id, data]) => ({ id, ...data }));

    // If no tiles, render a scaffold with a friendly message
    if (tiles.length === 0) {
        const empty = document.createElement('div');
        empty.id = 'board';
        empty.className = 'board-empty';
        empty.textContent = 'Board not initialized yet.';
        return empty;
    }

    // 2) Group tiles by column index (id pattern "col-row")
    /** @type {Record<number, Array<any>>} */
    const columns = {};
    for (const t of tiles) {
        const [cStr, rStr] = String(t.id).split('-');
        const c = Number(cStr), r = Number(rStr);
        if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
        if (!columns[c]) columns[c] = [];
        columns[c][r] = t;
    }

    const sortedCols = Object.entries(columns)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, arr]) => arr);

    const numCols = sortedCols.length;
    const numRows = Math.max(0, ...sortedCols.map(col => (Array.isArray(col) ? col.length : 0)));

    // 3) Create the grid root
    const board = document.createElement('div');
    board.id = 'board';
    // Column count is data-driven; gameBoard.css reads --cols (keeps styling in CSS).
    board.style.setProperty('--cols', String(numCols));
    board.setAttribute('role', 'grid');

    // 4) Category headers (top row)
    for (let c = 0; c < numCols; c++) {
        const header = document.createElement('div');
        header.className = 'category';
        header.setAttribute('role', 'columnheader');
        const firstRow = sortedCols[c]?.[0];
        header.textContent = firstRow?.category || `Category ${c + 1}`;
        board.appendChild(header);
    }

    // 5) Value tiles (row-major append, but each column preserves its internal order)
    for (let r = 0; r < numRows; r++) {
        for (let c = 0; c < numCols; c++) {
            const tile = sortedCols[c]?.[r];

            // Hole guard
            if (!tile) {
                const hole = document.createElement('div');
                hole.className = 'tile disabled';
                hole.textContent = '—';
                board.appendChild(hole);
                continue;
            }

            const div = document.createElement('div');
            div.className = 'tile';
            div.dataset.id = tile.id;
            div.setAttribute('role', 'button');
            div.setAttribute('tabindex', '0');

            const isAnswered = !!tile.answered;
            const isOpened = !!tile.opened;

            if (isAnswered) {
                div.classList.add('answered');
                div.textContent = '✔';
                div.style.cursor = 'default';
            } else {
                div.textContent = `${Number(tile.value ?? (r + 1) * 100)}`;
                if (isOpened) div.classList.add('opened');
            }

            // ----- Tile click handler ---------------------------
            const onTileActivate = async () => {
                if (div.classList.contains('answered')) return;
                if (div.dataset.busy === '1') return;     // prevent double-click races
                div.dataset.busy = '1';

                try {
                    if (onTileClick) {
                        // Use custom callback
                        await onTileClick({
                            id: tile.id,
                            category: tile.category,
                            value: Number(tile.value ?? (r + 1) * 100),
                            answered: isAnswered,
                            imageUrl: tile.imageUrl || tile.image || '',
                            answer: tile.answer || ''
                        });
                    }
                } catch (err) {
                    console.error('Failed to handle tile click:', err);
                } finally {
                    div.dataset.busy = '0';
                }
            };

            div.addEventListener('click', onTileActivate);
            div.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onTileActivate();
                }
            });

            board.appendChild(div);
        }
    }

    return board;
}
