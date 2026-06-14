// src/game/buzz.js
//
// Picture Twirl — Buzz Queue helpers (rules-friendly)
// -----------------------------------------------------------------------------
// Responsibilities
// - Players: enqueue a buzz at /games/{id}/buzzQueue/$pushId
// - Host: delete a single buzz or clear the entire queue safely
// - Controllers: subscribe to the ordered queue without duplicating logic
//
// Why this module?
// - Your RTDB rules allow writes at child level: buzzQueue/$pushId
//   (create by any authed player; delete by host). They do NOT allow
//   setting the *parent* buzzQueue node to null. So clearing must
//   remove each child entry individually.
// - This module centralizes that behavior so controllers don’t repeat it.
//
// Data shape (per rules & UI):
//   buzz entry = { uid: string, createdAt: (server timestamp number) }
//
// API
//   enqueueBuzz(gameId, opts?)         → { ok:boolean, status:'enqueued'|'duplicate_skipped' }
//   clearBuzzQueue(gameId)             → Promise<void> (host-only by rules)
// -----------------------------------------------------------------------------

import { rtdb, getCurrentUser } from '../firebase.js';
import {
    ref,
    get,
    set,
    push,
    update,
    serverTimestamp,
} from 'firebase/database';
import * as P from '../data/paths.js';

/**
 * Enqueue a buzz for the current user.
 * - If the user already has an entry in the queue, we skip adding another
 *   (client-side de-dupe; rules don’t force this).
 *
 * @param {string} gameId
 * @param {{ allowMultiple?: boolean }} [opts]
 * @returns {Promise<{ok: boolean, status: 'enqueued' | 'duplicate_skipped'}>}
 */
export async function enqueueBuzz(gameId, opts = {}) {
    const user = getCurrentUser();
    if (!user?.uid) throw new Error('Not signed in');

    const allowMultiple = !!opts.allowMultiple;
    const qRef = ref(rtdb, P.buzzQueue(gameId));

    if (!allowMultiple) {
        const snap = await get(qRef);
        const obj = snap.val() || {};
        const already = Object.values(obj).some((e) => e && e.uid === user.uid);
        if (already) return { ok: true, status: 'duplicate_skipped' };
    }

    const child = push(qRef);
    await set(child, {
        uid: user.uid,
        createdAt: serverTimestamp(), // server-aligned; rules only require presence
    });

    return { ok: true, status: 'enqueued' };
}

/**
 * Clear the entire buzz queue by deleting each child (host-only by rules).
 * IMPORTANT: Do NOT try to set the parent path to null; your rules gate writes
 * at buzzQueue/$pushId, not at the parent.
 * @param {string} gameId
 */
export async function clearBuzzQueue(gameId) {
    const qRef = ref(rtdb, P.buzzQueue(gameId));
    const snap = await get(qRef);
    const obj = snap.val();

    if (!obj) return; // nothing to clear

    const updates = {};
    for (const pushId of Object.keys(obj)) {
        updates[`${P.buzzQueue(gameId)}/${pushId}`] = null;
    }

    await update(ref(rtdb), updates);
}
