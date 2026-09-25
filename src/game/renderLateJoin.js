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

import { rtdb } from '../firebase.js';
import { ref, onValue } from 'firebase/database';
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

    const root = document.createElement('div');
    root.className = 'late-join-root';
    root.innerHTML = `
        <div class="late-join-card">
            <div class="late-join-spinner" aria-hidden="true"></div>
            <h1 class="late-join-title">Hang tight!</h1>
            <p class="late-join-body">Waiting for the Game Master to add you to a team…</p>
        </div>
    `;
    app.appendChild(root);

    if (uid) track(attachLivePresence(gameId, uid));

    // Watch my participant node: active → enter game; removed → denied/kicked → home
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
