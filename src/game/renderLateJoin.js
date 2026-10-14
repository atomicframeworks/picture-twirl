// src/game/renderLateJoin.js
//
// "Waiting for GM" screen shown to late joiners during a live game.
// Writes a pending join request, then polls the participant node for approval.
//
// Transitions:
//   status: 'active'  → disposeAll + renderGameUI(gameId)
//   node removed      → disposeAll + exitToHome (denied or kicked)
//   phase: 'ended'    → disposeAll + renderFinale
// -----------------------------------------------------------------------------

import { rtdb } from '../realtime/client.js';
import { ref, onValue, remove } from '../realtime/db.js';
import * as P from '../data/paths.js';
import { createDisposer, exitToHome } from './controllerKit.js';
import { renderGameUI } from './renderGame.js';
import { renderFinale } from './renderFinale.js';
import { renderRoundSetup } from './renderRoundSetup.js';
import { writePendingParticipant, attachLivePresence } from './participants.js';

export async function renderLateJoin(gameId) {
    const app = document.getElementById('app');
    app.innerHTML = '';

    let uid;
    try {
        uid = await writePendingParticipant(gameId);
    } catch (err) {
        console.error('[renderLateJoin] Could not write pending participant:', err);
        app.innerHTML = '<div style="padding:40px;text-align:center;color:var(--ink)">Could not join — please try again.</div>';
        return;
    }

    const { track, disposeAll } = createDisposer();

    const meRef = ref(rtdb, P.participant(gameId, uid));

    const root = document.createElement('div');
    root.className = 'late-join-root';
    root.innerHTML = `
        <div class="late-join-card">
            <div class="late-join-spinner" aria-hidden="true"></div>
            <h1 class="late-join-title">Hang tight!</h1>
            <p class="late-join-body">Waiting for the Game Master to add you to a team…</p>
            <button class="late-join-cancel-btn" type="button">Cancel request</button>
        </div>
    `;
    app.appendChild(root);

    // Shared helper: attempt to remove this player's pending record, then navigate.
    async function leaveAndGoHome(actionBtn, busyLabel) {
        actionBtn.disabled = true;
        const originalText = actionBtn.textContent;
        actionBtn.textContent = busyLabel;
        try {
            await remove(meRef);
            disposeAll();
            exitToHome(() => {});
        } catch (err) {
            console.error('[renderLateJoin] Remove failed:', err);
            const card = root.querySelector('.late-join-card');
            let errEl = card?.querySelector('.late-join-error');
            if (!errEl && card) {
                errEl = document.createElement('p');
                errEl.className = 'late-join-error';
                card.appendChild(errEl);
            }
            if (errEl) errEl.textContent = 'Could not leave. Please try again.';
            actionBtn.disabled = false;
            actionBtn.textContent = originalText;
        }
    }

    const cancelBtn = root.querySelector('.late-join-cancel-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => leaveAndGoHome(cancelBtn, 'Leaving…'));
    }

    // Replaces card content with denial message + OK action.
    let deniedShown = false;
    function showDenied() {
        if (deniedShown) return;
        deniedShown = true;
        const card = root.querySelector('.late-join-card');
        if (!card) return;
        card.innerHTML = `
            <p class="late-join-denied-icon" aria-hidden="true">🚫</p>
            <h1 class="late-join-title">Not admitted</h1>
            <p class="late-join-body">The Game Master didn't admit you to this game.</p>
            <button class="btn primary late-join-ok-btn" type="button">OK</button>
        `;
        const okBtn = card.querySelector('.late-join-ok-btn');
        if (okBtn) {
            okBtn.addEventListener('click', () => leaveAndGoHome(okBtn, 'Leaving…'));
        }
    }

    if (uid) track(attachLivePresence(gameId, uid));

    // Watch my participant node: active → enter game; denied → show message; removed → home
    track(onValue(ref(rtdb, P.participant(gameId, uid)), (snap) => {
        if (!snap.exists()) {
            disposeAll();
            exitToHome(() => {});
            return;
        }
        const p = snap.val() || {};
        if (p.status === 'active') {
            disposeAll();
            renderGameUI(gameId);
        } else if (p.status === 'denied') {
            showDenied();
        }
    }));

    // Watch phase: if game ends or goes to round setup, navigate accordingly.
    // 'sessionEnded' is treated the same as 'ended': route to renderFinale,
    // which will immediately show the session-ended card via its phase listener.
    track(onValue(ref(rtdb, P.phase(gameId)), (snap) => {
        const phase = snap.val();
        if (phase === 'ended' || phase === 'sessionEnded') {
            renderFinale(gameId, { dispose: disposeAll })
                .catch(() => exitToHome(disposeAll));
        } else if (phase === 'roundSetup') {
            renderRoundSetup(gameId, { dispose: disposeAll });
        }
    }));
}
