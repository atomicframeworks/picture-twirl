// src/game/controllerKit.js
//
// Picture Twirl — Shared controller helpers
// -----------------------------------------------------------------------------
// Logic that lobby.js and renderGame.js previously duplicated verbatim, pulled
// into one place. These are deliberately tiny and behavior-preserving: each was
// copied identically across both controllers.
//
//   createDisposer()                      → { track, disposeAll }
//   exitToHome(dispose)                   → dispose + clear session + reload
//   leaveGame(gameId, { uid, dispose })   → confirm + remove participant + exitToHome
//   confirmEndGame()                      → GM "End game" confirmation modal
//   endGame(gameId)                       → write state.phase = 'ended'
// -----------------------------------------------------------------------------

import { rtdb } from '../firebase.js';
import { ref, remove, update, serverTimestamp } from 'firebase/database';
import * as P from '../data/paths.js';
import { setSession } from '../session.js';
import { modal } from '../ui/modal.js';

/**
 * A small unsubscribe registry. `track(off)` collects teardown functions;
 * `disposeAll()` runs them all (swallowing errors) and clears the list.
 * @returns {{ track: (off: unknown) => void, disposeAll: () => void }}
 */
export function createDisposer() {
    const unsubs = [];
    const track = (off) => { if (typeof off === 'function') unsubs.push(off); };
    const disposeAll = () => {
        unsubs.forEach((off) => { try { off(); } catch { /* no-op */ } });
        unsubs.length = 0;
    };
    return { track, disposeAll };
}

/**
 * Tear down listeners, clear the local session, and reload back to Home.
 * Reload always happens, even if dispose throws.
 * @param {() => void} [dispose]
 */
export function exitToHome(dispose) {
    try {
        if (typeof dispose === 'function') dispose();
        setSession({ gameId: null, isGM: false });
    } finally {
        window.location.reload();
    }
}

/**
 * Confirm + leave the game as a player: remove our participant row, then exit
 * to Home. No-op (returns false) if the user cancels the confirmation.
 * @param {string} gameId
 * @param {{ uid: string|null, dispose?: () => void }} opts
 * @returns {Promise<boolean>} whether the user confirmed
 */
export async function leaveGame(gameId, { uid, dispose } = {}) {
    const res = await modal.confirm({
        title: 'Leave game?',
        body: 'If you leave now, you may not be able to rejoin this game in progress.',
        confirmText: 'Leave Game',
        cancelText: 'Stay in Game',
        variant: 'danger',
    });
    if (res !== 'confirm') return false;

    try {
        if (uid) await remove(ref(rtdb, P.participant(gameId, uid)));
    } catch (e) {
        console.warn('Leave game: remove failed', e);
    } finally {
        exitToHome(dispose);
    }
    return true;
}

/**
 * Show the GM "End game" confirmation. Returns the modal result
 * ('confirm' | 'cancel' | 'dismiss'). Kept separate from endGame() so callers
 * can manage their own busy-state between the confirm and the write.
 * @returns {Promise<string>}
 */
export function confirmEndGame() {
    return modal.confirm({
        title: 'End game?',
        body: 'This will end the game for everyone. You can’t undo this.',
        confirmText: 'End game',
        variant: 'danger',
    });
}

/**
 * Write the terminal game phase. Lets errors propagate so the caller can
 * surface them and reset its own busy state.
 * @param {string} gameId
 */
export async function endGame(gameId) {
    await update(ref(rtdb, P.state(gameId)), {
        phase: 'ended',
        endedAt: serverTimestamp(),
    });
}
