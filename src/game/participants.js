// src/game/participants.js
//
// Picture Twirl — Participant row + presence helpers
// -----------------------------------------------------------------------------
// Small, self-contained helpers for the /games/{id}/participants/{uid} node.
// Extracted from lobby.js so the lobby controller is about UI/flow, not the
// mechanics of writing a participant row.
//
//   ensureParticipant(gameId)        → create-or-update my participant row
//   attachPresence(gameId, uid)      → online/lastSeen + onDisconnect cleanup; returns unsubscribe
//   setTeam(gameId, uid, team)       → set a participant's team
// -----------------------------------------------------------------------------

import { rtdb, getCurrentUser } from '../firebase.js';
import { ref, onValue, onDisconnect, update, set, serverTimestamp, get } from 'firebase/database';
import * as P from '../data/paths.js';
import { getSession } from '../session.js';
import { LIMITS, TEAM } from '../config.js';

/**
 * Create my participant row if absent, otherwise refresh name/isGM while
 * preserving the existing team. No-op if not signed in.
 * @param {string} gameId
 */
export async function ensureParticipant(gameId) {
    const user = getCurrentUser(); if (!user) return;
    const { displayName, isGM } = getSession();
    const safeName = (displayName || `Player-${user.uid.slice(-4)}`).slice(0, LIMITS.DISPLAY_NAME);
    const meRef = ref(rtdb, P.participant(gameId, user.uid));
    const snap = await get(meRef);
    if (!snap.exists()) {
        await set(meRef, { displayName: safeName, team: TEAM.NONE, joinedAt: serverTimestamp(), isGM: !!isGM });
    } else {
        const cur = snap.val() || {};
        await update(meRef, { displayName: safeName, team: cur.team || TEAM.NONE, isGM: !!isGM });
    }
}

/**
 * Mark this client online and remove its participant node on disconnect, so the
 * lobby updates immediately when someone closes the tab.
 * @param {string} gameId
 * @param {string} uid
 * @returns {() => void} unsubscribe
 */
export function attachPresence(gameId, uid) {
    const connectedRef = ref(rtdb, '.info/connected');
    const meRef = ref(rtdb, P.participant(gameId, uid));
    const off = onValue(connectedRef, (c) => {
        if (c.val() !== true) return;
        update(meRef, { online: true, lastSeen: serverTimestamp() }).catch(() => { });
        onDisconnect(meRef).remove().catch(() => { });
    });
    return typeof off === 'function' ? off : () => { };
}

/**
 * Set a participant's team.
 * @param {string} gameId
 * @param {string} uid
 * @param {string} team  TEAM.A | TEAM.B | TEAM.NONE
 */
export const setTeam = (gameId, uid, team) => update(ref(rtdb, P.participant(gameId, uid)), { team });
