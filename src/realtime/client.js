// src/realtime/client.js
//
// The browser side of live games (PROPOSAL.md §8.4) — replaces src/firebase.js.
// -----------------------------------------------------------------------------
//   identity  an anonymous player { uid, token } from POST /api/player, kept in
//             localStorage (survives tab close and reload, so a host stays the
//             host — AUDIT M15). getCurrentUser() / requireAuth() keep the names
//             the game already used.
//   rooms     one WebSocket per game room (worker/rooms/GameRoom.js) holding a
//             local mirror of the room's tree; listeners fire when the part
//             they watch changes. Reconnects by itself and re-sends writes the
//             room hadn't confirmed (the room ignores duplicates).
//   clock     ping/pong against the room's clock → '.info/serverTimeOffset', so
//             every screen agrees on how far the swirl has unswirled.
// The Firebase-shaped API the game calls (ref, onValue, update, …) is db.js.
// -----------------------------------------------------------------------------

import { applyOps, getAt, overlaps, splitPath } from '../shared/tree.js';

const IDENTITY_KEY = 'pt.player.v1';
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 4000, 5000];
const PING_EVERY_MS = 10_000;
const GET_TIMEOUT_MS = 15_000;

const randomId = (n) => {
    const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(n)), b => a[b % a.length]).join('');
};

/** One id per page load: lets a room tell "this page reconnected" from "someone new". */
const PAGE_ID = `pg_${randomId(16)}`;
let writeSeq = 0;               // per page, increasing: the room's duplicate guard

/** Opaque handle the game passes to ref(rtdb, …) — kept so call sites didn't change. */
export const rtdb = Object.freeze({ kind: 'picture-twirl-realtime' });

// ── Identity ────────────────────────────────────────────────────────────────

let identity = readIdentity();
let identityPromise = null;

function readIdentity() {
    try {
        const v = JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null');
        return v?.uid && v?.token ? v : null;
    } catch { return null; }
}

function saveIdentity(v) {
    try {
        if (v) localStorage.setItem(IDENTITY_KEY, JSON.stringify(v));
        else localStorage.removeItem(IDENTITY_KEY);
    } catch { /* private mode: identity lasts for this page only */ }
}

/** The signed-in player ({ uid }) or null — same shape the game used from Firebase. */
export function getCurrentUser() {
    return identity ? { uid: identity.uid, isAnonymous: true } : null;
}

/** Make sure we have a player identity (creates one on first use). */
export async function requireAuth() {
    if (identity) return getCurrentUser();
    identityPromise ??= (async () => {
        const res = await fetch('/api/player', { method: 'POST', headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`Couldn’t start a player session (HTTP ${res.status}).`);
        identity = await res.json();
        saveIdentity(identity);
        return identity;
    })().finally(() => { identityPromise = null; });
    await identityPromise;
    return getCurrentUser();
}

/** Identity is read synchronously at load — nothing to wait for (kept for boot.js). */
export async function initializeRealtime() {}
export async function waitForAuthReady() {}
/** @deprecated name from src/firebase.js — kept so code merged from main still runs (MIGRATION.md). */
export const initializeFirebase = initializeRealtime;

function forgetIdentity() {
    identity = null;
    saveIdentity(null);
}

const authHeaders = () => (identity ? { Authorization: `Bearer ${identity.token}` } : {});

// ── Rooms over HTTP (join screen, create flow) ──────────────────────────────

/**
 * Does a game exist, what phase is it in, and am I its host?
 * @param {string} code
 * @returns {Promise<{ exists: boolean, phase: string|null, host: boolean }>}
 */
export async function getRoomInfo(code) {
    const res = await fetch(`/api/rooms/${encodeURIComponent(String(code).toLowerCase())}`, { headers: { Accept: 'application/json', ...authHeaders() } });
    if (res.status === 404) return { exists: false, phase: null, host: false };
    if (!res.ok) throw new Error(`Couldn’t check that game (HTTP ${res.status}).`);
    return res.json();
}

export async function gameExists(code) {
    return (await getRoomInfo(code)).exists;
}

/** A fresh, collision-free game code reserved for this player (AUDIT M4). */
export async function reserveGameCode() {
    for (let attempt = 0; attempt < 2; attempt++) {
        await requireAuth();
        const res = await fetch('/api/rooms', { method: 'POST', headers: { Accept: 'application/json', ...authHeaders() } });
        if (res.status === 401) { forgetIdentity(); continue; }      // stale token (secret rotated): new identity
        if (!res.ok) throw new Error(`Couldn’t get a game code (HTTP ${res.status}).`);
        return (await res.json()).code;
    }
    throw new Error('Couldn’t get a game code.');
}

// ── '.info' values (connected, serverTimeOffset) follow the CURRENT room ─────

const info = { connected: false, serverTimeOffset: 0 };
const infoListeners = { connected: new Set(), serverTimeOffset: new Set() };
let currentRoom = null;

function setInfo(name, value) {
    if (info[name] === value) return;
    info[name] = value;
    for (const cb of infoListeners[name]) { try { cb(value); } catch (e) { console.error(e); } }
}

/** Subscribe to '.info/connected' | '.info/serverTimeOffset'. Fires now, then on change. */
export function onInfo(name, cb) {
    const set = infoListeners[name];
    if (!set) throw new Error(`Unsupported .info/${name}`);
    set.add(cb);
    queueMicrotask(() => { if (set.has(cb)) cb(info[name]); });
    return () => set.delete(cb);
}

export const infoValue = (name) => info[name];

// ── Room connections ────────────────────────────────────────────────────────

const rooms = new Map();

/** The connection for a game code (created on first use; becomes the current room). */
export function room(code) {
    const key = String(code).toLowerCase();
    let r = rooms.get(key);
    if (!r) {
        r = new RoomConnection(key);
        rooms.set(key, r);
    }
    if (currentRoom !== r) {
        currentRoom = r;
        setInfo('connected', r.connected);
        setInfo('serverTimeOffset', r.offset);
    }
    return r;
}

class RoomConnection {
    constructor(code) {
        this.code = code;
        this.tree = null;
        this.synced = false;            // has received the room's state at least once
        this.connected = false;
        this.isHost = false;
        this.ws = null;
        this.listeners = new Set();     // { segs, cb, last }
        this.inflight = new Map();      // id → { msg, resolve, reject } — un-acknowledged requests
        this.nextId = 1;
        this.retry = 0;
        this.reconnectTimer = null;
        this.pingTimer = null;
        this.syncWaiters = [];
        this.offset = 0;
        this.samples = [];              // { rtt, offset } — clock sync
        this.stats = { reconnects: 0, lastRttMs: null };
        this.open();
    }

    // ── connection lifecycle ──
    async open() {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        try { await requireAuth(); } catch { this.scheduleReconnect(); return; }
        const url = new URL(`/api/rooms/${encodeURIComponent(this.code)}/ws`, window.location.href);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.searchParams.set('token', identity.token);
        url.searchParams.set('cid', PAGE_ID);
        let ws;
        try { ws = new WebSocket(url); } catch { this.scheduleReconnect(); return; }
        ws.initialized = false;
        this.ws = ws;
        ws.addEventListener('message', (e) => { if (this.ws === ws) this.onMessage(ws, e.data); });
        ws.addEventListener('close', (e) => { if (this.ws === ws) this.onClose(e); });
    }

    onClose(e) {
        this.ws = null;
        this.connected = false;
        clearInterval(this.pingTimer);
        if (currentRoom === this) setInfo('connected', false);
        if (e.code === 4401) forgetIdentity();          // token refused: get a new identity, then reconnect
        if (e.code === 4404) {                          // not a game code at all: give up, fail what's waiting
            this.shutDown = true;
            const err = Object.assign(new Error('NOT_FOUND: No game with that code.'), { code: 'not_found' });
            for (const { reject } of this.inflight.values()) reject(err);
            this.inflight.clear();
            this.syncWaiters.splice(0);
        }
        if (!this.shutDown) this.scheduleReconnect();
    }

    scheduleReconnect() {
        if (this.reconnectTimer) return;
        const base = RECONNECT_DELAYS_MS[Math.min(this.retry, RECONNECT_DELAYS_MS.length - 1)];
        this.retry++;
        this.reconnectTimer = setTimeout(() => this.open(), base + Math.random() * 250);
    }

    /** Reconnect right away (network back, tab visible again). */
    nudge() {
        if (this.ws || !this.reconnectTimer) return;
        this.retry = 0;
        this.open();
    }

    /** Leaving the page on purpose: tell the room, so it cleans up now (not after the grace period). */
    leave() {
        if (!this.ws) return;
        try {
            this.ws.send(JSON.stringify({ t: 'bye' }));
            this.ws.close(1000, 'bye');
        } catch { /* closing anyway */ }
    }

    // ── messages ──
    onMessage(ws, data) {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        switch (msg.t) {
            case 'init': return this.onInit(ws, msg);
            case 'patch': return this.onPatch(msg);
            case 'ack': return this.onAck(msg);
            case 'pong': return this.onPong(msg);
            default: return undefined;
        }
    }

    onInit(ws, msg) {
        const prev = this.tree;
        this.tree = msg.tree ?? null;
        this.isHost = !!msg.host;
        this.synced = true;
        this.notify(prev === this.tree ? [] : [[]]);
        this.syncWaiters.splice(0).forEach(fn => fn());
        if (ws.initialized) return;                    // a later init on the same socket (room created/deleted)

        ws.initialized = true;
        if (this.retry > 0 || this.stats.connectedOnce) this.stats.reconnects++;
        this.stats.connectedOnce = true;
        this.retry = 0;
        this.connected = true;
        // Whatever the room hadn't confirmed goes again, in order (duplicates are ignored).
        for (const id of [...this.inflight.keys()].sort((a, b) => a - b)) ws.send(JSON.stringify(this.inflight.get(id).msg));
        if (currentRoom === this) setInfo('connected', true);
        this.startPings();
    }

    onPatch(msg) {
        if (!Array.isArray(msg.ops)) return;
        const { tree, changed } = applyOps(this.tree, msg.ops);
        this.tree = tree;
        this.notify(changed);
    }

    onAck(msg) {
        const pending = this.inflight.get(msg.id);
        if (!pending) return;
        this.inflight.delete(msg.id);
        if (msg.ok) pending.resolve();
        else {
            const err = new Error(`${String(msg.code || 'error').toUpperCase()}: ${msg.message || 'The game refused that change.'}`);
            err.code = msg.code;
            pending.reject(err);
        }
    }

    // ── clock sync: offset = room time − local time, from the fastest recent round trip ──
    startPings() {
        clearInterval(this.pingTimer);
        const ping = () => this.ws?.send(JSON.stringify({ t: 'ping', id: 0, c: Date.now() }));
        ping();
        setTimeout(ping, 400);
        setTimeout(ping, 1200);
        this.pingTimer = setInterval(ping, PING_EVERY_MS);
    }

    onPong(msg) {
        const received = Date.now();
        const rtt = received - msg.c;
        if (!(rtt >= 0) || typeof msg.s !== 'number') return;
        this.stats.lastRttMs = rtt;
        this.samples.push({ rtt, offset: msg.s - (msg.c + received) / 2, at: received });
        if (this.samples.length > 12) this.samples.shift();
        const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        this.offset = Math.round(best.offset);
        if (currentRoom === this) setInfo('serverTimeOffset', this.offset);
    }

    // ── reads ──
    whenSynced() {
        if (this.synced) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Can’t reach the game right now — check your connection.')), GET_TIMEOUT_MS);
            this.syncWaiters.push(() => { clearTimeout(timer); resolve(); });
        });
    }

    async get(segs) {
        await this.whenSynced();
        return getAt(this.tree, segs);
    }

    /** Watch a path; cb(value) now (once synced) and whenever it changes. */
    listen(segs, cb) {
        const l = { segs, cb, last: undefined };
        this.listeners.add(l);
        if (this.synced) queueMicrotask(() => { if (this.listeners.has(l)) this.deliver(l); });
        return () => this.listeners.delete(l);
    }

    notify(changed) {
        for (const l of this.listeners) {
            if (l.last === undefined || changed.some(c => overlaps(c, l.segs))) this.deliver(l);
        }
    }

    deliver(l) {
        const value = getAt(this.tree, l.segs);
        const key = JSON.stringify(value);
        if (key === l.last) return;
        l.last = key;
        try { l.cb(value); } catch (e) { console.error('[realtime] listener failed', e); }
    }

    // ── writes ──
    request(msg) {
        msg.id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.inflight.set(msg.id, { msg, resolve, reject });
            if (this.ws?.initialized) this.ws.send(JSON.stringify(msg));
        });
    }

    /** ops: [{ p: room-relative path, v }] */
    write(ops) {
        return this.request({ t: 'w', seq: ++writeSeq, ops });
    }

    onDisconnectAdd(p, ops) {
        return this.request({ t: 'od', a: 'add', p, ops });
    }

    onDisconnectCancel(p) {
        return this.request({ t: 'od', a: 'cancel', p });
    }
}

// Network back / tab visible again → reconnect now instead of waiting out the back-off.
// (Browser only — tests run this module in Node.)
if (typeof window !== 'undefined' && typeof document !== 'undefined' && window.addEventListener) {
    const nudgeAll = () => rooms.forEach(r => r.nudge());
    window.addEventListener('online', nudgeAll);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') nudgeAll(); });
    // Closing / leaving the page: the room cleans up at once (lobby drops us, as before).
    window.addEventListener('pagehide', (e) => { if (!e.persisted) rooms.forEach(r => r.leave()); });
}

/** Debug + the M4 latency notes: window.PictureTwirl.realtime.stats() */
export function realtimeStats() {
    return [...rooms.values()].map(r => ({
        code: r.code,
        connected: r.connected,
        host: r.isHost,
        offsetMs: r.offset,
        lastRttMs: r.stats.lastRttMs,
        bestRttMs: r.samples.length ? Math.min(...r.samples.map(s => s.rtt)) : null,
        reconnects: r.stats.reconnects,
        pendingWrites: r.inflight.size,
    }));
}

/**
 * Debug/test aid: cut this page's game connections the way a dropped network
 * would (not a clean close — the room starts its grace period). The page
 * reconnects by itself. window.PictureTwirl.realtime.simulateDrop()
 */
export function simulateDrop() {
    for (const r of rooms.values()) { try { r.ws?.close(4000, 'simulated drop'); } catch { /* closing */ } }
}

// For tests (tests/realtime/client.test.mjs): inspect connections; stop everything.
export const _internal = {
    rooms,
    pageId: PAGE_ID,
    splitPath,
    shutdown() {
        for (const r of rooms.values()) {
            r.shutDown = true;
            clearTimeout(r.reconnectTimer);
            clearInterval(r.pingTimer);
            try { r.ws?.close(1000); } catch { /* closing */ }
        }
    },
};
