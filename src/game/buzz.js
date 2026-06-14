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
//   deleteBuzz(gameId, pushId)         → Promise<void> (host-only by rules)
//   clearBuzzQueue(gameId)             → Promise<void> (host-only by rules)
//   onBuzzQueue(gameId, cb)            → unsubscribe()  (ordered array of {id, uid, createdAt})
// -----------------------------------------------------------------------------

import { rtdb, getCurrentUser } from '../firebase.js';
import {
    ref,
    get,
    set,
    push,
    update,
    onValue,
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
 * Delete a single buzz entry (host-only by rules).
 * @param {string} gameId
 * @param {string} pushId
 */
export async function deleteBuzz(gameId, pushId) {
    if (!pushId) return;
    await update(ref(rtdb), { [`${P.buzzQueue(gameId)}/${pushId}`]: null });
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

/**
 * Subscribe to the buzz queue and receive an ordered list on each change.
 * The list is sorted ascending by createdAt.
 * @param {string} gameId
 * @param {(items: Array<{ id: string, uid: string, createdAt: number }>) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onBuzzQueue(gameId, cb) {
    const off = onValue(ref(rtdb, P.buzzQueue(gameId)), (snap) => {
        const obj = snap.val();
        if (!obj) return cb([]);

        const items = Object.entries(obj).map(([id, v]) => ({
            id,
            uid: v?.uid,
            createdAt: typeof v?.createdAt === 'number' ? v.createdAt : 0,
        }));

        items.sort((a, b) => a.createdAt - b.createdAt);
        cb(items);
    });
    return typeof off === 'function' ? off : () => { };
}
