// src/game/renderRoundSetup.js
//
// Round setup screen: GM picks a board for the next round; players wait.
// Mounted when state.phase === 'roundSetup'.
//
// GM flow:  Board picker (ui/boardPicker.js) → Ready to Start → Start Game (atomic reset)
// Player flow: Waiting screen (Leave game link)
//
// Navigation is driven by the shared phase listener:
//   live     → renderGameUI (round started)
//   ended    → renderFinale (GM went Back)

import { rtdb, getCurrentUser } from '../realtime/client.js';
import { ref, onValue, update, get, serverTimestamp } from '../realtime/db.js';
import * as P from '../data/paths.js';
import { getSession } from '../session.js';
import { loadBoardForGame } from './createGame.js';
import { createDisposer, leaveGame } from './controllerKit.js';
import { mountBoardPicker } from '../ui/boardPicker.js';

export async function renderRoundSetup(gameId, { dispose = null } = {}) {
    if (typeof dispose === 'function') dispose();

    const app = document.getElementById('app');
    const { isGM } = getSession();
    const user = getCurrentUser();
    const myUid = user?.uid;

    app.innerHTML = '';

    const { track, disposeAll } = createDisposer();

    // Shared phase listener — handles all transitions away from roundSetup
    track(onValue(ref(rtdb, P.phase(gameId)), async (snap) => {
        const ph = snap.val();
        if (ph === 'live') {
            disposeAll();
            const { renderGameUI } = await import('./renderGame.js');
            renderGameUI(gameId);
        } else if (ph === 'ended') {
            // GM went Back to finale — re-render it for all clients
            const { renderFinale } = await import('./renderFinale.js');
            renderFinale(gameId, { dispose: disposeAll });
        }
        // 'roundSetup' → already here; ignore the initial snapshot
    }));

    if (isGM) {
        mountGMSetup();
    } else {
        mountPlayerWaiting();
    }

    // ── GM: board picker → confirm screen ─────────────────────────────────────

    function mountGMSetup() {
        app.innerHTML = `
<div class="rsetup-root is-gm">

  <!-- Screen 1: Board picker -->
  <div class="rsetup-screen" id="rsetupPicker">
    <header class="rsetup-header">
      <h1 class="rsetup-title">Pick a Board</h1>
      <p class="rsetup-sub">Round 2</p>
    </header>
    <div class="rsetup-list-wrap">
      <div class="rsetup-card-list set-list" id="rsetupCards"></div>
    </div>
    <div class="actions-tray">
      <button class="btn primary" id="rsetupNext" disabled>Next →</button>
      <hr>
      <a href="#" class="exit-link" id="rsetupBackToFinale">← Back to Results</a>
    </div>
  </div>

  <!-- Screen 2: Ready to start -->
  <div class="rsetup-screen" id="rsetupConfirm" hidden>
    <div class="rsetup-confirm-inner">
      <div class="rsetup-confirm-icon" id="rsetupConfirmIcon" aria-hidden="true"></div>
      <h2 class="rsetup-confirm-heading">Ready for another round?</h2>
      <div class="rsetup-confirm-set-name" id="rsetupConfirmName"></div>
      <p class="rsetup-confirm-note">Same teams · Fresh scores</p>
    </div>
    <div class="actions-tray">
      <button class="btn primary" id="rsetupStart">Start Game</button>
      <hr>
      <a href="#" class="exit-link" id="rsetupBackToPicker">← Back</a>
    </div>
  </div>

</div>`;

        // Board cards (same component + markup as createFlow step 2)
        const cardsEl = document.getElementById('rsetupCards');
        const picker = cardsEl
            ? mountBoardPicker(cardsEl, {
                onChange: (board) => {
                    const nextBtn = document.getElementById('rsetupNext');
                    if (nextBtn) nextBtn.disabled = !board;
                },
            })
            : null;
        picker?.load();

        // Next → confirm screen
        document.getElementById('rsetupNext')?.addEventListener('click', () => {
            const board = picker?.getSelected();
            if (!board) return;
            const iconEl = document.getElementById('rsetupConfirmIcon');
            const nameEl = document.getElementById('rsetupConfirmName');
            if (iconEl) iconEl.textContent = board.emoji || '🎲';
            if (nameEl) nameEl.textContent = board.title;
            showScreen('confirm');
        });

        // Back to finale — write 'ended' so the phase listener navigates all clients
        document.getElementById('rsetupBackToFinale')?.addEventListener('click', async (e) => {
            e.preventDefault();
            await update(ref(rtdb, P.state(gameId)), { phase: 'ended' });
        });

        // Back to picker from confirm screen (local nav only, no RTDB write)
        document.getElementById('rsetupBackToPicker')?.addEventListener('click', (e) => {
            e.preventDefault();
            showScreen('picker');
        });

        // Start Game — atomic round reset then write phase: 'live'
        document.getElementById('rsetupStart')?.addEventListener('click', async () => {
            const board = picker?.getSelected();
            if (!board) return;
            const startBtn = document.getElementById('rsetupStart');
            if (startBtn?.dataset.busy === '1') return;
            if (startBtn) { startBtn.disabled = true; startBtn.dataset.busy = '1'; }
            try {
                await startRound(board.id);
                // phase: 'live' write triggers the phase listener → all clients go to renderGameUI
            } catch (err) {
                console.error('[renderRoundSetup] startRound failed:', err);
                if (startBtn) { startBtn.disabled = false; startBtn.dataset.busy = '0'; }
            }
        });

        function showScreen(name) {
            const picker = document.getElementById('rsetupPicker');
            const confirm = document.getElementById('rsetupConfirm');
            if (picker) picker.hidden = (name !== 'picker');
            if (confirm) confirm.hidden = (name !== 'confirm');
        }
    }

    // ── Players: waiting screen ───────────────────────────────────────────────

    function mountPlayerWaiting() {
        app.innerHTML = `
<div class="rsetup-root">
  <div class="rsetup-waiting">
    <div class="rsetup-waiting-icon" aria-hidden="true">🎯</div>
    <h2 class="rsetup-waiting-title">Getting ready…</h2>
    <p class="rsetup-waiting-body">The Game Master is setting up the next round.</p>
  </div>
  <div class="actions-tray rsetup-leave-tray">
    <a href="#" class="exit-link" id="rsetupLeave">Leave Game</a>
  </div>
</div>`;

        document.getElementById('rsetupLeave')?.addEventListener('click', async (e) => {
            e.preventDefault();
            await leaveGame(gameId, { uid: myUid, dispose: disposeAll });
        });
    }

    // ── Atomic round reset ────────────────────────────────────────────────────

    async function startRound(boardId) {
        const now = serverTimestamp();
        const { board, boardMeta } = await loadBoardForGame(boardId, now);

        // Fetch participants to reset per-player round stats
        const partsSnap = await get(ref(rtdb, P.participants(gameId)));
        const parts = partsSnap.val() || {};

        const writes = {
            // Scores reset
            [`${P.scores(gameId)}/A`]: 0,
            [`${P.scores(gameId)}/B`]: 0,
            // Fresh board
            [P.board(gameId)]: board,
            // Clear game-flow state
            [`${P.game(gameId)}/currentQuestion`]: null,
            [`${P.game(gameId)}/selectedTile`]: null,
            [`${P.game(gameId)}/currentTurn`]: null,
            [`${P.game(gameId)}/swirlPaused`]: null,
            [`${P.game(gameId)}/swirlStartTime`]: null,
            [`${P.game(gameId)}/buzzQueue`]: null,
            // Record which board (and version) this round plays
            [P.boardId(gameId)]: boardMeta.boardId,
            [`${P.settings(gameId)}/boardRev`]: boardMeta.boardRev,
            // Advance phase — triggers navigation on all clients
            [`${P.state(gameId)}/phase`]: 'live',
            [`${P.state(gameId)}/endedAt`]: null,
        };

        // Per-participant: clear round stats and play-again votes
        for (const uid of Object.keys(parts)) {
            writes[`${P.participant(gameId, uid)}/playAgainVote`] = null;
            writes[`${P.participant(gameId, uid)}/pointsEarned`] = null;
            writes[`${P.participant(gameId, uid)}/correctAnswers`] = null;
            writes[`${P.participant(gameId, uid)}/tileRequest`] = null;
        }

        await update(ref(rtdb), writes);
    }
}
