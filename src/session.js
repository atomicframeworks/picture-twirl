// src/session.js
//
// Picture Twirl — Ephemeral Session State
// -----------------------------------------------------------------------------
// Purpose
// - Keep lightweight UI/session state (gameId, isGM, displayName) outside RTDB.
// - Persist to sessionStorage so refreshes don't lose context.
// - Provide a small observable API for controllers that care about changes.
//
// Design
// - State is a plain object: { gameId: string|null, isGM: boolean, displayName: string }
// - Partial updates via setSession(patch) → merged + persisted.
// - Read via getSession() (returns a frozen shallow copy).
// - Subscribe via onSessionChange(cb) → () => unsubscribe.
// - Cross-tab sync: listens to "storage" events and rehydrates.
//
// Notes
// - Keep this SMALL. All game logic belongs in controllers/services.
// - Do not put secrets or durable data here; RTDB is the source of truth.
// -----------------------------------------------------------------------------

import { LIMITS } from './config.js';

const STORAGE_KEY = 'pt.session.v1';

/** @typedef {{ gameId: string|null, isGM: boolean, displayName: string }} Session */

let _state = /** @type {Session} */ ({
    gameId: null,
    isGM: false,
    displayName: '',
});

/** @type {Set<(s: Session) => void>} */
const _subs = new Set();

/** Shallow compare to avoid noisy re-renders. */
function _shallowEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (a[k] !== b[k]) return false;
    return true;
}

/** Coerce & sanitize a partial patch into Session fields only. */
function _coercePatch(patch) {
    const out = {};
    if (patch == null || typeof patch !== 'object') return out;

    if ('gameId' in patch) {
        const v = patch.gameId;
        out.gameId = (v == null || v === '') ? null : String(v).slice(0, LIMITS.GAME_ID);
    }
    if ('isGM' in patch) {
        out.isGM = !!patch.isGM;
    }
    if ('displayName' in patch) {
        const name = (patch.displayName ?? '').toString().trim();
        out.displayName = name.slice(0, LIMITS.DISPLAY_NAME);
    }
    return out;
}

/** Persist current state to sessionStorage. */
function _save() {
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
    } catch {
        // ignore storage failures (private mode, quota, etc.)
    }
}

/** Load initial state from sessionStorage. */
function _load() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const patch = _coercePatch(parsed);
        _state = Object.freeze({ ..._state, ...patch });
    } catch {
        // ignore malformed data
    }
}

/** Notify all subscribers (with frozen snapshot). */
function _emit() {
    const snap = Object.freeze({ ..._state });
    for (const fn of _subs) {
        try { fn(snap); } catch { /* no-op */ }
    }
    // Broadcast for optional observers (devtools, lightweight router, etc.)
    try {
        const evt = new CustomEvent('app:session-changed', { detail: { session: snap } });
        window.dispatchEvent(evt);
    } catch { /* no-op */ }
}

// Initialize from storage once on module load
_load();

/**
 * Get the current session snapshot.
 * @returns {Session} Frozen shallow copy to discourage mutation.
 */
export function getSession() {
    return Object.freeze({ ..._state });
}

/**
 * Merge a partial update into the session and persist it.
 * Only known fields are applied (gameId, isGM, displayName).
 * @param {Partial<Session>} patch
 */
export function setSession(patch) {
    const clean = _coercePatch(patch);
    const next = Object.freeze({ ..._state, ...clean });
    if (_shallowEqual(next, _state)) return; // no change

    _state = next;
    _save();
    _emit();
}

/** Reset to a pristine session (clears gameId, isGM and displayName). */
export function clearSession() {
    const next = Object.freeze({ gameId: null, isGM: false, displayName: '' });
    if (_shallowEqual(next, _state)) return;
    _state = next;
    _save();
    _emit();
}

/**
 * Subscribe to session changes.
 * @param {(s: Session) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onSessionChange(cb) {
    if (typeof cb !== 'function') return () => { };
    _subs.add(cb);
    // immediate sync
    try { cb(getSession()); } catch { /* no-op */ }
    return () => _subs.delete(cb);
}

// Cross-tab sync (same origin). If another tab updates sessionStorage,
// we rehydrate and emit only when state actually changed.
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY) return;
        // Re-load and conditionally emit
        const prev = _state;
        _load();
        if (!_shallowEqual(prev, _state)) _emit();
    });
}
