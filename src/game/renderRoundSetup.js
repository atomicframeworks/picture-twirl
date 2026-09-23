// src/game/renderRoundSetup.js
//
// Round setup screen: GM picks a category for the next round; players wait.
// Mounted when state.phase === 'roundSetup'.
//
// GM flow:  Category picker → Ready to Start → Start Game (atomic reset)
// Player flow: Waiting screen (Leave game link)
//
// Navigation is driven by the shared phase listener:
//   live     → renderGameUI (round started)
//   ended    → renderFinale (GM went Back)

import { rtdb, getCurrentUser } from '../firebase.js';
import { ref, onValue, update, get, serverTimestamp } from 'firebase/database';
import * as P from '../data/paths.js';
import { getSession } from '../session.js';
import { predefinedGames } from '../predefinedGames.js';
import { buildBoardFromSet } from './createGame.js';
import { createDisposer, leaveGame } from './controllerKit.js';
import { escapeHtml } from '../ui/format.js';

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

    // ── GM: category picker → confirm screen ──────────────────────────────────

    function mountGMSetup() {
        app.innerHTML = `
<div class="rsetup-root is-gm">

  <!-- Screen 1: Category picker -->
  <div class="rsetup-screen" id="rsetupPicker">
    <header class="rsetup-header">
      <h1 class="rsetup-title">Choose a Category</h1>
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

        let selectedSetId = '';

        // Render set cards (same markup/classes as createFlow step 2)
        const cardsEl = document.getElementById('rsetupCards');
        if (cardsEl) {
            const sets = Array.isArray(predefinedGames) ? predefinedGames : [];
            cardsEl.innerHTML = sets.map(s => {
                const icon = escapeHtml(s.icon || '🃏');
                const sub = s.subtitle || s.description || '';
                return `<button class="set-card" data-set="${escapeHtml(s.id)}" type="button" aria-pressed="false">
  <div class="set-ic" aria-hidden="true">${icon}</div>
  <div>
    <div class="set-title">${escapeHtml(s.title || s.id)}</div>
    ${sub ? `<div class="set-sub">${escapeHtml(sub)}</div>` : ''}
  </div>
</button>`;
            }).join('');

            cardsEl.querySelectorAll('.set-card').forEach(btn => {
                btn.addEventListener('click', () => {
                    selectedSetId = btn.getAttribute('data-set') || '';
                    cardsEl.querySelectorAll('.set-card').forEach(b => {
                        const sel = b.getAttribute('data-set') === selectedSetId;
                        b.classList.toggle('is-selected', sel);
                        b.setAttribute('aria-pressed', sel ? 'true' : 'false');
                    });
                    const nextBtn = document.getElementById('rsetupNext');
                    if (nextBtn) nextBtn.disabled = false;
                });
            });
        }

        // Next → confirm screen
        document.getElementById('rsetupNext')?.addEventListener('click', () => {
            if (!selectedSetId) return;
            const gameSet = predefinedGames.find(s => s.id === selectedSetId);
            const iconEl = document.getElementById('rsetupConfirmIcon');
            const nameEl = document.getElementById('rsetupConfirmName');
            if (iconEl) iconEl.textContent = gameSet?.icon || '🃏';
            if (nameEl) nameEl.textContent = gameSet?.title || selectedSetId;
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
            if (!selectedSetId) return;
            const startBtn = document.getElementById('rsetupStart');
            if (startBtn?.dataset.busy === '1') return;
            if (startBtn) { startBtn.disabled = true; startBtn.dataset.busy = '1'; }
            try {
                await startRound(selectedSetId);
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

    async function startRound(setId) {
        const gameSet = predefinedGames.find(s => s.id === setId);
        if (!gameSet) throw new Error(`Unknown setId: "${setId}"`);

        const now = serverTimestamp();
        const board = buildBoardFromSet(gameSet, now);

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
            // Update category setting for the new round
            [`${P.settings(gameId)}/setId`]: setId,
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
