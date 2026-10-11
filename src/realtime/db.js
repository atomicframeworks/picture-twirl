// src/realtime/db.js
//
// A Firebase-Realtime-Database-shaped API over our GameRoom connections
// (src/realtime/client.js), so the game moved off Firebase without its logic
// changing — only the import lines did (PROPOSAL.md §8.4; old code: MIGRATION.md):
//
//   import { ref, onValue, get, set, update, remove, push, serverTimestamp,
//            increment, onDisconnect } from '../realtime/db.js';
//
// Paths:
//   games/<code>/…        that game's room (the room's tree is the game node)
//   gameIndex/<code>      accepted and ignored — a game exists when its room has
//                         a tree (GET /api/rooms/:code tells the join screen)
//   .info/connected       is the current game's socket connected?
//   .info/serverTimeOffset   ms to add to Date.now() for the room's clock
// Semantics follow Firebase: set replaces, update replaces each listed child,
// null deletes, onValue fires with the current value and again on every change
// to that location; writes resolve once the room confirms them (and everyone,
// including this page, has already been sent the change).

import { getAt, joinPath, splitPath } from '../shared/tree.js';
import { infoValue, onInfo, room } from './client.js';

// ── References ──────────────────────────────────────────────────────────────

class Reference {
    constructor(segs) {
        this.segs = segs;
        this.key = segs.length ? segs[segs.length - 1] : null;
    }

    get path() { return joinPath(this.segs); }

    get parent() { return this.segs.length ? new Reference(this.segs.slice(0, -1)) : null; }

    get root() { return new Reference([]); }

    child(path) { return new Reference([...this.segs, ...splitPath(path)]); }

    toString() { return `/${this.path}`; }
}

/** ref(rtdb, 'games/abc123/participants') — rtdb is accepted for call-site compatibility. */
export function ref(db, path = '') {
    return new Reference(splitPath(path));
}

export const child = (parent, path) => parent.child(path);

/** Where a path lives. */
const GAME_CODE = /^[a-z0-9]{4,12}$/i;

function locate(segs) {
    if (segs[0] === '.info') return { info: segs[1] };
    if (segs[0] === 'games' && segs.length >= 2 && GAME_CODE.test(segs[1])) return { code: segs[1].toLowerCase(), rel: segs.slice(2) };
    if (segs[0] === 'gameIndex') return { ignore: true };
    return { unsupported: true };
}

const unsupported = (r) => new Error(`Realtime: unsupported path "${r.toString()}" (only games/<game code>/… and .info/…).`);

// ── Snapshots ───────────────────────────────────────────────────────────────

const isObject = (v) => v !== null && typeof v === 'object';
const clone = (v) => (isObject(v) ? JSON.parse(JSON.stringify(v)) : v);

/** Firebase's key order: integer-like keys numerically first, then the rest as strings. */
function orderedKeys(obj) {
    const ints = [];
    const rest = [];
    for (const k of Object.keys(obj)) (/^(0|-?[1-9]\d{0,9})$/.test(k) ? ints : rest).push(k);
    ints.sort((a, b) => Number(a) - Number(b));
    rest.sort();
    return [...ints, ...rest];
}

class DataSnapshot {
    constructor(reference, value) {
        this.ref = reference;
        this.key = reference.key;
        this._v = value === undefined ? null : value;
    }

    val() { return clone(this._v); }

    exists() { return this._v !== null; }

    child(path) { return new DataSnapshot(this.ref.child(path), getAt(this._v, path)); }

    hasChild(path) { return getAt(this._v, path) !== null; }

    hasChildren() { return isObject(this._v) && Object.keys(this._v).length > 0; }

    numChildren() { return isObject(this._v) ? Object.keys(this._v).length : 0; }

    get size() { return this.numChildren(); }

    /** Children in key order; return true from the callback to stop. */
    forEach(action) {
        if (!isObject(this._v)) return false;
        for (const k of orderedKeys(this._v)) {
            if (action(new DataSnapshot(this.ref.child(k), this._v[k])) === true) return true;
        }
        return false;
    }

    toJSON() { return this.val(); }
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Watch a location. callback(snapshot) fires with the current value, then on
 * every change. Returns the unsubscribe function (like Firebase v9+).
 */
export function onValue(query, callback, cancelCallback) {
    const loc = locate(query.segs);
    if (loc.info) return onInfo(loc.info, (v) => callback(new DataSnapshot(query, v)));
    if (loc.code) return room(loc.code).listen(loc.rel, (v) => callback(new DataSnapshot(query, v)));
    const err = unsupported(query);
    if (typeof cancelCallback === 'function') queueMicrotask(() => cancelCallback(err));
    else throw err;
    return () => {};
}

/** Read a location once. */
export async function get(query) {
    const loc = locate(query.segs);
    if (loc.info) return new DataSnapshot(query, infoValue(loc.info));
    if (loc.code) return new DataSnapshot(query, await room(loc.code).get(loc.rel));
    if (loc.ignore) return new DataSnapshot(query, null);
    throw unsupported(query);
}

// ── Writes ──────────────────────────────────────────────────────────────────

/** Group [{ segs, v }] by room; drop ignored paths; refuse the rest. */
function writeAll(entries) {
    const byRoom = new Map();
    for (const { segs, v } of entries) {
        const loc = locate(segs);
        if (loc.ignore) continue;
        if (!loc.code) return Promise.reject(unsupported(new Reference(segs)));
        if (!byRoom.has(loc.code)) byRoom.set(loc.code, []);
        byRoom.get(loc.code).push({ p: joinPath(loc.rel), v: v === undefined ? null : v });
    }
    return Promise.all([...byRoom].map(([code, ops]) => room(code).write(ops))).then(() => undefined);
}

/** Replace the value at a location (null deletes). */
export const set = (reference, value) => writeAll([{ segs: reference.segs, v: value }]);

/** Replace each listed child; keys may be deep paths ('a/b/c'). */
export function update(reference, values) {
    const entries = Object.entries(values || {}).map(([k, v]) => ({ segs: [...reference.segs, ...splitPath(k)], v }));
    return entries.length ? writeAll(entries) : Promise.resolve();
}

export const remove = (reference) => set(reference, null);

// Firebase push ids: 8 chars of time + 12 random, so they sort chronologically.
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
let lastPushTime = 0;
let lastRandChars = [];
function pushId() {
    let t = Date.now();
    const duplicateTime = t === lastPushTime;
    lastPushTime = t;
    const timeChars = new Array(8);
    for (let i = 7; i >= 0; i--) { timeChars[i] = PUSH_CHARS.charAt(t % 64); t = Math.floor(t / 64); }
    if (!duplicateTime) {
        lastRandChars = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b % 64);
    } else {
        let i = 11;
        for (; i >= 0 && lastRandChars[i] === 63; i--) lastRandChars[i] = 0;
        if (i >= 0) lastRandChars[i]++;
    }
    return timeChars.join('') + lastRandChars.map(n => PUSH_CHARS.charAt(n)).join('');
}

/**
 * A new child with a time-ordered key. With a value it is also written and the
 * returned reference is awaitable (Firebase's ThenableReference).
 */
export function push(parent, value) {
    const reference = parent.child(pushId());
    if (value === undefined) return reference;
    // Resolve with a plain (non-thenable) reference, as Firebase does — resolving
    // with the thenable itself would make `await push(…)` unwrap it forever.
    const plain = new Reference(reference.segs);
    const done = set(reference, value).then(() => plain);
    reference.then = done.then.bind(done);
    reference.catch = done.catch.bind(done);
    return reference;
}

/** Placeholder the room replaces with its own clock (ms). */
export const serverTimestamp = () => ({ '.sv': 'timestamp' });

/** Placeholder the room replaces with (current number + delta) — atomic, no lost updates. */
export const increment = (delta) => ({ '.sv': { increment: Number(delta) || 0 } });

/**
 * Writes the room makes when this page's connection ends — at once if the
 * page closed, after a short grace period if the connection just dropped (and
 * not at all if it comes back in time).
 */
export function onDisconnect(reference) {
    const loc = locate(reference.segs);
    const base = loc.code ? joinPath(loc.rel) : '';
    const register = (ops) => (loc.code ? room(loc.code).onDisconnectAdd(base, ops) : Promise.resolve());
    return {
        set: (v) => register([{ p: base, v: v === undefined ? null : v }]),
        update: (values) => register(Object.entries(values || {}).map(([k, v]) => ({ p: joinPath([...loc.rel, ...splitPath(k)]), v: v === undefined ? null : v }))),
        remove: () => register([{ p: base, v: null }]),
        cancel: () => (loc.code ? room(loc.code).onDisconnectCancel(base) : Promise.resolve()),
    };
}
