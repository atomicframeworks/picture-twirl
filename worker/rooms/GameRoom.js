// worker/rooms/GameRoom.js
//
// One live game = one GameRoom Durable Object (named by the game code): the
// single authoritative copy of the game's JSON tree, pushed to every player
// over WebSockets (PROPOSAL.md §8.4). Replaces Firebase's Realtime Database.
// Rules + views are in roomCore.js (pure, unit-tested); this file is the
// plumbing: storage, sockets (Hibernation API — idle rooms cost nothing),
// disconnect clean-up, and alarms.
// -----------------------------------------------------------------------------
// Protocol (JSON text frames) — client: src/realtime/client.js
//   → { t:'w',    id, seq, ops:[{p,v}] }       write (set/update/remove/push)
//   → { t:'od',   id, a:'add', p, ops } | { t:'od', id, a:'cancel', p }
//                                               onDisconnect(ref).set/update/remove / cancel
//   → { t:'ping', id, c }                       clock sync + keep-alive
//   → { t:'bye' }                               leaving on purpose (tab closed)
//   ← { t:'init',  tree, uid, host, now }      on connect (the viewer's view)
//   ← { t:'patch', ops:[{p,v}] }               after every change, to everyone
//   ← { t:'ack',   id, ok, code?, message? }   to the writer, after the patch
//   ← { t:'pong',  id, c, s }
// Writes carry a per-page sequence number (seq): a write re-sent after a
// reconnect is acknowledged but never applied twice.
// -----------------------------------------------------------------------------
// Disconnects: a socket that closes cleanly (tab closed, 'bye') runs its
// onDisconnect ops at once — the lobby drops the player immediately, as with
// Firebase. A connection that just DROPS (Wi-Fi, phone asleep) gets a grace
// period: if the same page reconnects within it, nothing happens.
// Idle rooms (no change for a day, nobody connected) delete themselves.
// -----------------------------------------------------------------------------

import { splitPath, isPrefix } from '../../src/shared/tree.js';
import { applyWrite, patchOps, patchRoots, roleOf, roomInfo, viewFor } from './roomCore.js';

export const ROOM_TIMING = {
    GRACE_MS: 30_000,                 // a dropped connection may come back within this
    IDLE_MS: 24 * 60 * 60_000,        // untouched for this long (and nobody connected) → deleted
    CLAIM_MS: 10 * 60_000,            // a reserved code is held this long for its creator
};
// Tests shorten these with Worker vars (ROOM_GRACE_MS, ROOM_IDLE_MS, ROOM_CLAIM_MS);
// production never sets them.
const timing = (env, key) => Number(env?.[`ROOM_${key}`]) || ROOM_TIMING[key];
const MAX_FRAME_BYTES = 300 * 1024;
const MAX_OD_PER_PAGE = 20;

export class GameRoom {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        this.lastTs = 0;
        this.loaded = false;
        ctx.blockConcurrencyWhile(() => this.load());
    }

    async load() {
        if (this.loaded) return;
        const got = await this.ctx.storage.get(['tree', 'meta', 'claim', 'od', 'pending', 'seqs']);
        this.tree = got.get('tree') ?? null;
        this.meta = got.get('meta') ?? { lastActivity: 0 };
        this.claim = got.get('claim') ?? null;                // { uid, at } — a reserved, not-yet-created code
        this.od = got.get('od') ?? {};                        // cid → { uid, items: [{ p, ops }] }
        this.pending = got.get('pending') ?? {};              // cid → { uid, items, runAt } (grace period)
        this.seqs = got.get('seqs') ?? {};                    // cid → last applied write seq
        this.loaded = true;
    }

    /** The room clock: wall time, strictly increasing (so buzz order = arrival order). */
    now() {
        this.lastTs = Math.max(Date.now(), this.lastTs + 1);
        return this.lastTs;
    }

    // ── HTTP (from the Worker: worker/routes/rooms.js) ──────────────────────

    async fetch(request) {
        await this.load();
        const url = new URL(request.url);
        const uid = request.headers.get('x-pt-uid') || null;
        if (url.pathname === '/info') return Response.json(roomInfo(this.tree, uid));
        if (url.pathname === '/reserve' && request.method === 'POST') return this.reserve(uid);
        if (url.pathname === '/ws') return this.connect(request, uid);
        return new Response('Not found', { status: 404 });
    }

    reserve(uid) {
        if (!uid) return new Response('No identity', { status: 400 });
        const claim = this.activeClaim();
        if (this.tree !== null || (claim && claim.uid !== uid)) return Response.json({ ok: false }, { status: 409 });
        this.claim = { uid, at: Date.now() };
        this.ctx.storage.put('claim', this.claim);
        this.schedule();
        return Response.json({ ok: true });
    }

    activeClaim() {
        return this.claim && Date.now() - this.claim.at < timing(this.env, 'CLAIM_MS') ? this.claim : null;
    }

    connect(request, uid) {
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
        const cid = request.headers.get('x-pt-cid');
        if (!uid || !cid) return new Response('Missing identity', { status: 400 });

        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ uid, cid, bye: false });

        // The same page is back (within the grace period, or before we even
        // noticed it was gone): forget the disconnect. Disconnect actions belong
        // to a connection (as in Firebase) — the page registers them again now.
        if (this.pending[cid] || this.od[cid]) {
            delete this.pending[cid];
            delete this.od[cid];
            this.ctx.storage.put({ pending: this.pending, od: this.od });
            this.schedule();
        }
        this.send(server, { t: 'init', tree: viewFor(this.tree, uid), uid, host: roleOf(this.tree, uid) === 'host', now: Date.now() });
        return new Response(null, { status: 101, webSocket: client });
    }

    // ── Socket events (Hibernation API) ─────────────────────────────────────

    async webSocketMessage(ws, data) {
        await this.load();
        const att = ws.deserializeAttachment() || {};
        const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
        if (text.length > MAX_FRAME_BYTES) return this.send(ws, { t: 'ack', id: null, ok: false, code: 'too_large', message: 'Message too large.' });
        let msg;
        try { msg = JSON.parse(text); } catch { return; }
        if (!msg || typeof msg !== 'object') return;

        switch (msg.t) {
            case 'ping': return this.send(ws, { t: 'pong', id: msg.id, c: msg.c, s: Date.now() });
            case 'w': return this.onWrite(ws, att, msg);
            case 'od': return this.onDisconnectOp(ws, att, msg);
            case 'bye': return ws.serializeAttachment({ ...att, bye: true });
            default: return undefined;
        }
    }

    async webSocketClose(ws, code) {
        await this.load();
        this.closed(ws, code);
    }

    async webSocketError(ws) {
        await this.load();
        this.closed(ws, 1006);
    }

    closed(ws, code) {
        const { uid, cid, bye } = ws.deserializeAttachment() || {};
        try { ws.close(); } catch { /* already closed */ }
        if (!cid) return;
        // Another socket from the same page is still open (a reconnect overtook the old one).
        const sameLive = this.ctx.getWebSockets().some(s => s !== ws && s.deserializeAttachment()?.cid === cid);
        if (sameLive) return;
        const reg = this.od[cid];
        if (!reg?.items?.length) return;
        delete this.od[cid];
        this.ctx.storage.put('od', this.od);
        if (bye || code === 1000 || code === 1001) {
            this.runDisconnect({ uid: reg.uid || uid, items: reg.items });
        } else {
            this.pending[cid] = { uid: reg.uid || uid, items: reg.items, runAt: Date.now() + timing(this.env, 'GRACE_MS') };
            this.ctx.storage.put('pending', this.pending);
            this.schedule();
        }
    }

    async alarm() {
        await this.load();
        const t = Date.now();
        let ran = false;
        for (const [cid, p] of Object.entries(this.pending)) {
            if (p.runAt > t) continue;
            delete this.pending[cid];
            ran = true;
            this.runDisconnect(p);
        }
        if (ran) this.ctx.storage.put('pending', this.pending);

        const nobody = this.ctx.getWebSockets().length === 0;
        const idle = t - (this.meta.lastActivity || 0) >= timing(this.env, 'IDLE_MS');
        const gone = this.tree === null && !this.activeClaim() && !Object.keys(this.pending).length;
        if (nobody && ((this.tree !== null && idle) || gone)) {
            await this.ctx.storage.deleteAll();
            this.tree = null; this.claim = null; this.od = {}; this.pending = {}; this.seqs = {}; this.meta = { lastActivity: 0 };
            return;
        }
        this.schedule();
    }

    // ── Writes ──────────────────────────────────────────────────────────────

    onWrite(ws, att, msg) {
        const seq = Number(msg.seq);
        if (Number.isFinite(seq) && seq <= (this.seqs[att.cid] ?? 0)) {
            return this.send(ws, { t: 'ack', id: msg.id, ok: true, dup: true });   // re-sent after a reconnect; already applied
        }
        const res = applyWrite(this.tree, msg.ops, { uid: att.uid, now: () => this.now(), claimedBy: this.activeClaim()?.uid ?? null });
        if (Number.isFinite(seq)) this.seqs[att.cid] = seq;
        if (!res.ok) {
            this.ctx.storage.put('seqs', this.seqs);
            return this.send(ws, { t: 'ack', id: msg.id, ok: false, code: res.code, message: res.message });
        }
        this.commit(res);
        this.send(ws, { t: 'ack', id: msg.id, ok: true });
        return undefined;
    }

    /** Store a successful write and push it to everyone. */
    commit(res) {
        const before = this.tree;
        if (res.noop) {
            this.ctx.storage.put('seqs', this.seqs);
            return;
        }
        this.tree = res.tree;
        this.meta.lastActivity = Date.now();
        if (this.tree === null) {
            // The host deleted the game.
            this.claim = null;
            this.ctx.storage.delete(['tree', 'claim']);
            this.ctx.storage.put({ meta: this.meta, seqs: this.seqs });
        } else {
            if (before === null && this.claim) { this.claim = null; this.ctx.storage.delete('claim'); }
            this.ctx.storage.put({ tree: this.tree, meta: this.meta, seqs: this.seqs });
        }
        this.broadcast(before, res.changed);
        this.schedule();
    }

    broadcast(before, changed) {
        const rolesChanged = (before?.hostUid ?? null) !== (this.tree?.hostUid ?? null);
        const roots = patchRoots(changed);
        const frames = new Map();       // role → JSON (computed once per role)
        for (const ws of this.ctx.getWebSockets()) {
            const { uid } = ws.deserializeAttachment() || {};
            if (rolesChanged) {
                this.send(ws, { t: 'init', tree: viewFor(this.tree, uid), uid, host: roleOf(this.tree, uid) === 'host', now: Date.now() });
                continue;
            }
            const role = roleOf(this.tree, uid) === 'host' ? 'host' : 'player';
            if (!frames.has(role)) {
                const view = role === 'host' ? this.tree : viewFor(this.tree, null);
                frames.set(role, JSON.stringify({ t: 'patch', ops: patchOps(view, roots) }));
            }
            this.sendRaw(ws, frames.get(role));
        }
    }

    // ── onDisconnect ────────────────────────────────────────────────────────

    onDisconnectOp(ws, att, msg) {
        const reg = this.od[att.cid] ?? { uid: att.uid, items: [] };
        if (msg.a === 'cancel') {
            const base = splitPath(msg.p);
            reg.items = reg.items.filter(it => !isPrefix(base, splitPath(it.p)));
        } else {
            // Checked now (like Firebase) so a registration that could never run fails loudly.
            const check = applyWrite(this.tree, msg.ops, { uid: att.uid, now: () => this.now() });
            if (!check.ok) return this.send(ws, { t: 'ack', id: msg.id, ok: false, code: check.code, message: check.message });
            if (reg.items.length >= MAX_OD_PER_PAGE) return this.send(ws, { t: 'ack', id: msg.id, ok: false, code: 'too_many', message: 'Too many disconnect actions.' });
            reg.items.push({ p: String(msg.p ?? ''), ops: msg.ops });
        }
        this.od[att.cid] = reg;
        this.ctx.storage.put('od', this.od);
        this.send(ws, { t: 'ack', id: msg.id, ok: true });
        return undefined;
    }

    runDisconnect({ uid, items }) {
        for (const item of items) {
            const res = applyWrite(this.tree, item.ops, { uid, now: () => this.now() });
            if (res.ok) this.commit(res);       // rules re-checked at run time; a refused op is skipped
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /** One alarm covers both disconnect grace periods and idle clean-up. */
    schedule() {
        const times = Object.values(this.pending).map(p => p.runAt);
        if (this.tree !== null) times.push((this.meta.lastActivity || Date.now()) + timing(this.env, 'IDLE_MS'));
        else if (this.claim) times.push(this.claim.at + timing(this.env, 'CLAIM_MS'));
        else if (this.meta.lastActivity) times.push(Date.now() + 60_000);   // a deleted game's leftovers
        if (times.length) this.ctx.storage.setAlarm(Math.min(...times));
        else this.ctx.storage.deleteAlarm();
    }

    send(ws, msg) {
        this.sendRaw(ws, JSON.stringify(msg));
    }

    sendRaw(ws, text) {
        try { ws.send(text); } catch { /* socket closing; its close handler cleans up */ }
    }
}
