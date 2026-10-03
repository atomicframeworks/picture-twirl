#!/usr/bin/env node
// scripts/measure-realtime.mjs — `npm run measure:realtime [-- --url https://… --n 200]`
//
// Measures live-game latency through a GameRoom (PROPOSAL.md §8.4, M4 notes):
//   ping      a socket's round trip to the room (clock sync uses the fastest)
//   ack       a player's write → the room confirms it (write round trip)
//   delivery  a player's write → ANOTHER player receives the change
//             (what everyone "feels": a buzz, a team pick)
// Without --url it boots the Worker locally (tests/realtime/_harness.mjs), so the
// numbers are machine-local; run it against staging/production after cutover
// for real-world numbers. Creates one throwaway game and deletes it at the end.

import { parseArgs } from 'node:util';
import { openSocket, startRealtime } from '../tests/realtime/_harness.mjs';

const { values: o } = parseArgs({ options: { url: { type: 'string' }, n: { type: 'string', default: '200' } } });
const N = Math.max(10, Math.min(2000, Number(o.n) || 200));

const local = !o.url;
const rt = local ? await startRealtime() : null;
const base = (o.url || rt.base).replace(/\/$/, '');
const call = (p, init) => fetch(`${base}${p}`, init);

async function player() {
    const res = await call('/api/player', { method: 'POST' });
    if (!res.ok) throw new Error(`/api/player → HTTP ${res.status}`);
    return res.json();
}

/** A protocol client with an inbox (a message arriving right after 'open' is never lost). */
async function socket(code, who) {
    const cid = `m_${Math.random().toString(36).slice(2, 12)}`;
    const c = await openSocket(`${base.replace(/^http/, 'ws')}/api/rooms/${code}/ws?token=${encodeURIComponent(who.token)}&cid=${cid}`, cid);
    return { ws: c.ws, next: (pred) => c.next(pred, 10_000), send: (m) => c.send(m) };
}

const stats = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { min: s[0], median: q(0.5), p95: q(0.95), max: s.at(-1) };
};
const fmt = (st) => `min ${st.min.toFixed(1)} · median ${st.median.toFixed(1)} · p95 ${st.p95.toFixed(1)} · max ${st.max.toFixed(1)} ms`;

try {
    const host = await player();
    const res = await call('/api/rooms', { method: 'POST', headers: { Authorization: `Bearer ${host.token}` } });
    const { code } = await res.json();
    const h = await socket(code, host);
    await h.next(m => m.t === 'init');
    h.send({ t: 'w', id: 1, seq: 1, ops: [{ p: '', v: { hostUid: host.uid, title: 'latency', state: { phase: 'lobby' } } }] });
    await h.next(m => m.t === 'ack' && m.id === 1);

    const [amy, bob] = [await player(), await player()];
    const a = await socket(code, amy);
    const b = await socket(code, bob);
    await Promise.all([a.next(m => m.t === 'init'), b.next(m => m.t === 'init')]);
    a.send({ t: 'w', id: 1, seq: 1, ops: [{ p: `participants/${amy.uid}`, v: { displayName: 'Amy', team: 'none', isGM: false } }] });
    await a.next(m => m.t === 'ack' && m.id === 1);

    const ping = [];
    for (let i = 0; i < N; i++) {
        const c = performance.now();
        a.send({ t: 'ping', id: i, c: Date.now() });
        await a.next(m => m.t === 'pong' && m.id === i);
        ping.push(performance.now() - c);
    }

    const ack = [];
    const delivery = [];
    for (let i = 0; i < N; i++) {
        const name = `Amy ${i}`;
        const seen = b.next(m => m.t === 'patch' && m.ops.some(op => op.v?.displayName === name));
        const acked = a.next(m => m.t === 'ack' && m.id === i + 10);
        const t0 = performance.now();
        a.send({ t: 'w', id: i + 10, seq: i + 10, ops: [{ p: `participants/${amy.uid}/displayName`, v: name }] });
        const [tSeen, tAck] = await Promise.all([seen.then(() => performance.now()), acked.then(() => performance.now())]);
        delivery.push(tSeen - t0);
        ack.push(tAck - t0);
    }

    h.send({ t: 'w', id: 2, seq: 2, ops: [{ p: '', v: null }] });          // delete the throwaway game
    await h.next(m => m.t === 'ack' && m.id === 2);
    for (const s of [h, a, b]) s.ws.close(1000);

    console.log(`Realtime latency — ${local ? 'local workerd (this machine)' : base} — ${N} samples each`);
    console.log(`  ping      ${fmt(stats(ping))}`);
    console.log(`  ack       ${fmt(stats(ack))}   (write → confirmed)`);
    console.log(`  delivery  ${fmt(stats(delivery))}   (one player's write → another player has it)`);
} finally {
    await rt?.close();
}
