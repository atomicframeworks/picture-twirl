// tests/realtime/_harness.mjs — boots the REAL Worker, GameRoom Durable Objects
// included, in local workerd (wrangler's createTestHarness), and gives tests a
// small WebSocket client that speaks the room protocol (worker/rooms/GameRoom.js).
//
//   const rt = await startRealtime();            // fresh storage per call
//   const amy = await rt.player();               // { uid, token }
//   const code = await rt.reserve(amy);
//   const ws = await rt.connect(code, amy);      // first message: { t: 'init' }
//   await ws.write([{ p: '', v: { hostUid: amy.uid } }]);
//   await ws.next(m => m.t === 'patch');
//   await rt.close();
//
// The config is derived from wrangler.jsonc at runtime (one source of truth):
// no static assets (the tests don't need them), throwaway secrets, and short
// room timers (ROOM_GRACE_MS) so disconnect tests don't wait 30 s.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
import { readWranglerConfig as readConfig } from '../../scripts/lib/wranglerConfig.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const readWranglerConfig = () => readConfig(ROOT);
export { readWranglerConfig };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export { sleep };

export async function startRealtime({ vars = {} } = {}) {
    const cfg = readWranglerConfig();
    delete cfg.$schema;
    delete cfg.assets;
    cfg.main = path.join(ROOT, cfg.main);
    cfg.d1_databases = (cfg.d1_databases || []).map(d => ({ ...d, migrations_dir: path.join(ROOT, d.migrations_dir) }));
    cfg.vars = { SESSION_SECRET: 'test-session-secret', ROOM_GRACE_MS: '400', ...vars };

    const dir = mkdtempSync(path.join(ROOT, '.wrangler', 'realtime-'));
    const configPath = path.join(dir, 'wrangler.json');
    writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    const server = createTestHarness({ root: ROOT, workers: [{ configPath }] });
    const { url } = await server.listen();
    const base = url.href.replace(/\/$/, '');
    const sockets = new Set();

    const rt = {
        base,
        server,
        worker: () => server.getWorker(),
        fetch: (p, init) => server.fetch(p, init),
        async player() {
            const res = await server.fetch('/api/player', { method: 'POST' });
            if (res.status !== 201) throw new Error(`player: HTTP ${res.status}`);
            return res.json();
        },
        async reserve(who) {
            const res = await server.fetch('/api/rooms', { method: 'POST', headers: { Authorization: `Bearer ${who.token}` } });
            if (res.status !== 201) throw new Error(`reserve: HTTP ${res.status}`);
            return (await res.json()).code;
        },
        async info(code, who = null) {
            const res = await server.fetch(`/api/rooms/${code}`, { headers: who ? { Authorization: `Bearer ${who.token}` } : {} });
            return res.json();
        },
        async connect(code, who, { cid = `cid_${Math.random().toString(36).slice(2, 12)}`, token = who.token } = {}) {
            const ws = await openSocket(`${base.replace(/^http/, 'ws')}/api/rooms/${code}/ws?token=${encodeURIComponent(token)}&cid=${cid}`, cid);
            sockets.add(ws);
            return ws;
        },
        async close() {
            for (const s of sockets) s.terminate();
            await server.close();
            rmSync(dir, { recursive: true, force: true });
        },
    };
    return rt;
}

/** A test client for the room protocol. Messages queue up; next(pred) takes the first match. */
export async function openSocket(url, cid) {
    const ws = new WebSocket(url);
    const inbox = [];
    const waiters = new Set();
    let closed = null;
    const flush = () => {
        for (const w of [...waiters]) {
            const i = inbox.findIndex(w.pred);
            if (i >= 0) { waiters.delete(w); clearTimeout(w.timer); w.resolve(inbox.splice(i, 1)[0]); }
            else if (closed && w.untilClose) { waiters.delete(w); clearTimeout(w.timer); w.resolve(null); }
        }
    };
    ws.addEventListener('message', (e) => { inbox.push(JSON.parse(e.data)); flush(); });
    ws.addEventListener('close', (e) => { closed = { code: e.code, reason: e.reason }; flush(); });
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', () => reject(new Error(`socket failed: ${url}`)), { once: true });
    });

    let id = 0;
    let seq = 0;
    const client = {
        ws,
        cid,
        inbox,
        get closed() { return closed; },
        /** Take the first queued (or next arriving) message matching pred. */
        next(pred = () => true, timeoutMs = 3000) {
            const i = inbox.findIndex(pred);
            if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
            return new Promise((resolve, reject) => {
                const w = { pred, resolve };
                w.timer = setTimeout(() => { waiters.delete(w); reject(new Error(`timed out waiting for a message (have: ${JSON.stringify(inbox).slice(0, 300)})`)); }, timeoutMs);
                waiters.add(w);
            });
        },
        /** Resolves with null if no matching message arrives within ms. */
        async none(pred, ms = 300) {
            await sleep(ms);
            const i = inbox.findIndex(pred);
            return i >= 0 ? inbox[i] : null;
        },
        send(msg) { ws.send(JSON.stringify(msg)); },
        async write(ops, { seq: forcedSeq } = {}) {
            const msgId = ++id;
            client.send({ t: 'w', id: msgId, seq: forcedSeq ?? ++seq, ops });
            return client.next(m => m.t === 'ack' && m.id === msgId);
        },
        async onDisconnect(p, ops) {
            const msgId = ++id;
            client.send({ t: 'od', id: msgId, a: 'add', p, ops });
            return client.next(m => m.t === 'ack' && m.id === msgId);
        },
        async ping() {
            const c = Date.now();
            client.send({ t: 'ping', id: ++id, c });
            const pong = await client.next(m => m.t === 'pong' && m.c === c);
            return { rtt: Date.now() - c, pong };
        },
        /** Close the way a browser tab does (1000) — or abruptly (no close code → 1005). */
        close(code) { if (code) ws.close(code); else ws.close(); },
        terminate() { try { ws.close(); } catch { /* ignore */ } },
        waitClosed(timeoutMs = 3000) {
            if (closed) return Promise.resolve(closed);
            return new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error('socket did not close')), timeoutMs);
                ws.addEventListener('close', () => { clearTimeout(t); resolve(closed); }, { once: true });
            });
        },
    };
    return client;
}
