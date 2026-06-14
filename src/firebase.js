// src/firebase.js
//
// Picture Twirl — Firebase bootstrap + tiny helpers
// -----------------------------------------------------------------------------
// Responsibilities
// - Initialize Firebase App and Realtime Database (singleton).
// - Guarantee Anonymous Auth is ready before the app does privileged work.
// - Expose tiny helpers used by flows/controllers:
//     initializeFirebase(), waitForAuthReady(), requireAuth(), gameExists(),
//     getCurrentUser(), and the exported RTDB instance `rtdb`.
//
// Notes
// - Config sources (first match wins):
//     1) window.__FIREBASE_CONFIG__  (drop your config on window before boot)
//     2) import.meta.env.VITE_FIREBASE_* (Vite-style envs)
// - If your build already initializes Firebase elsewhere, this module will
//   reuse the existing instance safely (getApps()).
// - All functions are idempotent; calling them multiple times is fine.
// -----------------------------------------------------------------------------

import { initializeApp, getApps } from 'firebase/app';
import {
    getAuth,
    onAuthStateChanged,
    signInAnonymously,
} from 'firebase/auth';
import {
    getDatabase,
    ref,
    get,
} from 'firebase/database';

// -----------------------------------------------------------------------------
// Singletons
// -----------------------------------------------------------------------------
let _app = null;
let _auth = null;
let _db = null;

/** The shared RTDB instance (set after initializeFirebase()). */
export let rtdb = null;

/** Cached user and an "auth became ready" promise. */
let _currentUser = null;
let _authReadyPromise = null;
let _authReadyResolve = null;
let _signInInflight = null;

// -----------------------------------------------------------------------------
// Config discovery
// -----------------------------------------------------------------------------
function readConfig() {
    // 1) window.__FIREBASE_CONFIG__ (recommended for plain HTML builds)
    if (typeof window !== 'undefined' && window.__FIREBASE_CONFIG__) {
        return window.__FIREBASE_CONFIG__;
    }

    // 2) Vite-style env (map into Firebase config shape if present)
    if (typeof import.meta !== 'undefined' && import.meta.env) {
        const E = import.meta.env;
        if (E.VITE_FIREBASE_API_KEY && E.VITE_FIREBASE_PROJECT_ID) {
            return {
                apiKey: E.VITE_FIREBASE_API_KEY,
                authDomain: E.VITE_FIREBASE_AUTH_DOMAIN,
                databaseURL: E.VITE_FIREBASE_DATABASE_URL,
                projectId: E.VITE_FIREBASE_PROJECT_ID,
                appId: E.VITE_FIREBASE_APP_ID,
            };
        }
    }

    // 3) Fallback — let Firebase complain loudly if missing
    return null;
}

// -----------------------------------------------------------------------------
// Init + Auth lifecycle
// -----------------------------------------------------------------------------
export async function initializeFirebase() {
    if (_app && _auth && _db) return; // already initialized

    // Reuse an existing app if one exists
    const config = readConfig();
    if (getApps().length) {
        _app = getApps()[0];
    } else {
        if (!config) {
            throw new Error(
                'Firebase config missing. Provide window.__FIREBASE_CONFIG__ or VITE_FIREBASE_* envs.'
            );
        }
        _app = initializeApp(config);
    }

    _auth = getAuth(_app);
    _db = getDatabase(_app);
    rtdb = _db;

    // Create a single promise that resolves on the first auth state emission
    if (!_authReadyPromise) {
        _authReadyPromise = new Promise((resolve) => {
            _authReadyResolve = resolve;
        });

        onAuthStateChanged(_auth, (user) => {
            _currentUser = user || null;
            if (_authReadyResolve) {
                _authReadyResolve();
                _authReadyResolve = null;
            }
        });
    }
}

/**
 * Wait until the first onAuthStateChanged fires (user may be null at this point).
 * Use this to avoid "permission-race" where UI enables actions before auth.uid exists.
 */
export async function waitForAuthReady() {
    if (!_authReadyPromise) await initializeFirebase();
    await _authReadyPromise;
}

/**
 * Ensure we have an auth user. If no user, sign in anonymously.
 * Returns the current user after login (or existing user if already signed in).
 */
export async function requireAuth() {
    await initializeFirebase();
    await waitForAuthReady();

    if (_auth.currentUser) {
        _currentUser = _auth.currentUser;
        return _currentUser;
    }

    // De-duplicate concurrent sign-in attempts
    if (!_signInInflight) {
        _signInInflight = signInAnonymously(_auth)
            .catch((e) => {
                console.error('Anonymous sign-in failed:', e);
                throw e;
            })
            .finally(() => {
                _signInInflight = null;
            });
    }

    await _signInInflight;
    _currentUser = _auth.currentUser;
    return _currentUser;
}

/** Get the current auth user (may be null if called before requireAuth()). */
export function getCurrentUser() {
    return _auth?.currentUser || _currentUser || null;
}

/**
 * Public existence check used by the Join flow:
 *   /gameIndex/{gameId} → true
 * Rules: .read should be allowed (public or auth != null based on your policy).
 */
export async function gameExists(gameId) {
    await initializeFirebase();
    const s = await get(ref(_db, `gameIndex/${gameId}`));
    return s.exists() && Boolean(s.val());
}
