// tests/realtime/rooms.test.mjs — the GameRoom Durable Object over real
// WebSockets in local workerd (worker/rooms/GameRoom.js, worker/routes/rooms.js):
// identities, collision-free codes, create/join, rules on the wire, answers
// hidden from players, buzz order, atomic increments, re-sent writes applied
// once, disconnect clean-up (clean close vs dropped connection + grace period),
// hibernation, and deleting a game. PROPOSAL.md §8.4 (M4 acceptance).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, startRealtime } from './_harness.mjs';

let rt;
before(async () => { rt = await startRealtime(); });
after(() => rt?.close());

const ts = { '.sv': 'timestamp' };

/** A new game in the lobby: host + room code + host socket (init consumed). */
async function newGame(extra = {}) {
    const host = await rt.player();
    const code = await rt.reserve(host);
    const ws = await rt.connect(code, host);
    assert.deepEqual((await ws.next(m => m.t === 'init')).tree, null);
    const ack = await ws.write([{ p: '', v: {
        hostUid: host.uid, title: 'Test', createdAt: ts, state: { phase: 'lobby' }, scores: { A: 0, B: 0 },
        board: { '0-0': { id: '0-0', answer: 'Bagel', imageUrl: '/media/display/a.webp', value: 100 } },
        participants: { [host.uid]: { displayName: 'GM', team: 'none', joinedAt: ts, isGM: true } },
        ...extra,
    } }]);
    assert.equal(ack.ok, true, JSON.stringify(ack));
    const init = await ws.next(m => m.t === 'init' && m.host === true);
    return { host, code, ws, init };
}

/** A player who joined the lobby (init consumed). */
async function join(code, name = 'Amy') {
    const who = await rt.player();
    const ws = await rt.connect(code, who);
    await ws.next(m => m.t === 'init');
    const ack = await ws.write([{ p: `participants/${who.uid}`, v: { displayName: name, team: 'none', joinedAt: ts, isGM: false } }]);
    assert.equal(ack.ok, true, JSON.stringify(ack));
    return { who, ws };
}

test('identities are signed: a forged or missing token is refused (close 4401), a bad page id too (4400)', async () => {
    const amy = await rt.player();
    assert.match(amy.uid, /^p_[0-9a-z]{16}$/);
    const code = await rt.reserve(amy);
    const forged = await rt.connect(code, amy, { token: `${amy.uid}.not-the-signature` });
    assert.equal((await forged.waitClosed()).code, 4401);
    const otherUid = await rt.connect(code, amy, { token: amy.token.replace(/^p_[0-9a-z]+/, 'p_aaaaaaaaaaaaaaaa') });
    assert.equal((await otherUid.waitClosed()).code, 4401);
    const badCid = await rt.connect(code, amy, { cid: 'x' });
    assert.equal((await badCid.waitClosed()).code, 4400);
    assert.equal((await rt.fetch('/api/rooms', { method: 'POST' })).status, 401);
});

test('codes: 6 unambiguous characters, never a live game; a reserved code is only for its creator', async () => {
    const amy = await rt.player();
    const codes = new Set();
    for (let i = 0; i < 5; i++) codes.add(await rt.reserve(amy));
    assert.equal(codes.size, 5);
    for (const c of codes) assert.match(c, /^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/);

    const code = [...codes][0];
    const bob = await rt.player();
    const ws = await rt.connect(code, bob);
    await ws.next(m => m.t === 'init');
    const stolen = await ws.write([{ p: '', v: { hostUid: bob.uid } }]);
    assert.equal(stolen.code, 'code_taken');
    assert.deepEqual(await rt.info(code), { exists: false, phase: null, host: false });
    assert.equal((await rt.fetch('/api/rooms/NOT*VALID')).status, 404);
});

test('create → host view; a player joins and gets the player view (no answers, no upcoming pictures)', async () => {
    const { host, code, ws: hostWs, init } = await newGame();
    assert.equal(init.tree.board['0-0'].answer, 'Bagel');
    assert.deepEqual(await rt.info(code, host), { exists: true, phase: 'lobby', host: true });

    const amy = await rt.player();
    const amyWs = await rt.connect(code, amy);
    const amyInit = await amyWs.next(m => m.t === 'init');
    assert.equal(amyInit.host, false);
    assert.equal(amyInit.tree.board['0-0'].answer, undefined);
    assert.equal(amyInit.tree.board['0-0'].imageUrl, undefined);
    assert.equal(amyInit.tree.board['0-0'].value, 100);
    assert.deepEqual(await rt.info(code, amy), { exists: true, phase: 'lobby', host: false });

    // Her join reaches the host as a patch.
    await amyWs.write([{ p: `participants/${amy.uid}`, v: { displayName: 'Amy', team: 'none', joinedAt: ts, isGM: false } }]);
    const patch = await hostWs.next(m => m.t === 'patch' && m.ops.some(o => o.p === `participants/${amy.uid}`));
    assert.equal(patch.ops[0].v.displayName, 'Amy');
    assert.equal(typeof patch.ops[0].v.joinedAt, 'number');
});

test('the question: players get the picture but not the answer — until the host reveals it', async () => {
    const { code, ws: host } = await newGame();
    const { ws: amy } = await join(code);
    await host.write([
        { p: 'state/phase', v: 'live' },
        { p: 'currentQuestion', v: { id: '0-0', answer: 'Bagel', imageUrl: '/media/display/a.webp', value: 100, showAnswer: false } },
        { p: 'swirlStartTime', v: ts },
    ]);
    const posted = await amy.next(m => m.t === 'patch' && m.ops.some(o => o.p === 'currentQuestion'));
    const q = posted.ops.find(o => o.p === 'currentQuestion').v;
    assert.equal(q.imageUrl, '/media/display/a.webp');
    assert.equal(q.answer, undefined);
    assert.ok(!JSON.stringify(posted).includes('Bagel'), 'no answer anywhere in the frame');

    await host.write([{ p: 'currentQuestion/showAnswer', v: true }]);
    const revealed = await amy.next(m => m.t === 'patch' && m.ops.some(o => o.p === 'currentQuestion'));
    assert.equal(revealed.ops.find(o => o.p === 'currentQuestion').v.answer, 'Bagel');
});

test('rules on the wire: a refused write is acked as refused and nobody else hears about it', async () => {
    const { host, code, ws: hostWs } = await newGame();
    const { ws: amy } = await join(code);
    const res = await amy.write([{ p: `participants/${host.uid}/team`, v: 'A' }]);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'permission_denied');
    assert.equal((await amy.write([{ p: 'scores/A', v: 9999 }])).code, 'permission_denied');
    assert.equal(await hostWs.none(m => m.t === 'patch' && m.ops.some(o => o.p.startsWith('scores'))), null);
});

test('buzz order is arrival order (one room clock), and each player buzzes once', async () => {
    const { code, ws: host } = await newGame();
    const { who: amy, ws: amyWs } = await join(code, 'Amy');
    const { who: bob, ws: bobWs } = await join(code, 'Bob');
    await host.write([{ p: 'state/phase', v: 'live' }, { p: 'currentQuestion', v: { id: '0-0', answer: 'Bagel', value: 100, showAnswer: false } }]);
    // Bob first, then Amy — with push ids that sort the OTHER way, so only the clock decides.
    assert.equal((await bobWs.write([{ p: 'buzzQueue/zzzz', v: { uid: bob.uid, createdAt: ts } }])).ok, true);
    assert.equal((await amyWs.write([{ p: 'buzzQueue/aaaa', v: { uid: amy.uid, createdAt: ts } }])).ok, true);
    assert.equal((await amyWs.write([{ p: 'buzzQueue/bbbb', v: { uid: amy.uid, createdAt: ts } }])).code, 'duplicate_buzz');
    await host.next(m => m.t === 'patch' && m.ops.some(o => o.p === 'buzzQueue/aaaa'));
    const order = Object.values((await rt.connect(code, amy).then(s => s.next(m => m.t === 'init'))).tree.buzzQueue)
        .sort((a, b) => a.createdAt - b.createdAt).map(e => e.uid);
    assert.deepEqual(order, [bob.uid, amy.uid]);
});

test('increments are atomic: two host tabs awarding at once both count', async () => {
    const { host, code, ws: tab1 } = await newGame();
    const tab2 = await rt.connect(code, host);
    await tab2.next(m => m.t === 'init');
    const inc = { '.sv': { increment: 100 } };
    await Promise.all([tab1.write([{ p: 'scores/A', v: inc }]), tab2.write([{ p: 'scores/A', v: inc }])]);
    const latest = await rt.connect(code, host).then(s => s.next(m => m.t === 'init'));
    assert.equal(latest.tree.scores.A, 200);
});

test('a write re-sent after a reconnect (same page, same seq) is applied once', async () => {
    const { host, code, ws } = await newGame();
    const inc = [{ p: 'scores/B', v: { '.sv': { increment: 50 } } }];
    assert.equal((await ws.write(inc, { seq: 1000 })).ok, true);
    const again = await rt.connect(code, host, { cid: ws.cid });       // the same page, reconnected
    await again.next(m => m.t === 'init');
    const dup = await again.write(inc, { seq: 1000 });
    assert.equal(dup.ok, true);
    assert.equal(dup.dup, true);
    const latest = await rt.connect(code, host).then(s => s.next(m => m.t === 'init'));
    assert.equal(latest.tree.scores.B, 50);
});

test('closing the tab runs the page’s disconnect actions at once (the lobby drops the player)', async () => {
    const { code, ws: host } = await newGame();
    const { who: amy, ws: amyWs } = await join(code);
    assert.equal((await amyWs.onDisconnect(`participants/${amy.uid}`, [{ p: `participants/${amy.uid}`, v: null }])).ok, true);
    amyWs.close(1000);
    const gone = await host.next(m => m.t === 'patch' && m.ops.some(o => o.p === `participants/${amy.uid}` && o.v === null), 2000);
    assert.ok(gone);
});

test('a dropped connection gets a grace period: back in time → nothing happens; not back → actions run', async () => {
    const { code, ws: host } = await newGame();
    const { who: amy, ws: amyWs } = await join(code);
    const offline = [{ p: `participants/${amy.uid}/online`, v: false }, { p: `participants/${amy.uid}/lastSeen`, v: ts }];
    await amyWs.write([{ p: `participants/${amy.uid}/online`, v: true }]);
    assert.equal((await amyWs.onDisconnect(`participants/${amy.uid}`, offline)).ok, true);

    // Drops (no close code) and comes back within the grace period (400 ms in tests).
    amyWs.close();
    await sleep(100);
    const back = await rt.connect(code, amy, { cid: amyWs.cid });
    await back.next(m => m.t === 'init');
    // (Patches carry whole rows: participants/<uid>.)
    const wentOffline = (m) => m.t === 'patch' && m.ops.some(o => o.p === `participants/${amy.uid}` && o.v?.online === false);
    assert.equal(await host.none(wentOffline, 700), null);

    // Registers again (as the page does on reconnect), drops, and stays away.
    assert.equal((await back.onDisconnect(`participants/${amy.uid}`, offline)).ok, true);
    back.close();
    const ran = await host.next(wentOffline, 3000);
    assert.equal(typeof ran.ops[0].v.lastSeen, 'number');
});

test('hibernation: a room evicted from memory wakes with its state and sockets intact', async () => {
    const { code, ws: host } = await newGame();
    const { who: amy, ws: amyWs } = await join(code);
    await rt.worker().evictDurableObject('ROOMS', { name: code, webSockets: 'hibernate' });
    await amyWs.write([{ p: `participants/${amy.uid}/team`, v: 'A' }]);
    const patch = await host.next(m => m.t === 'patch' && m.ops.some(o => o.p === `participants/${amy.uid}` && o.v?.team === 'A'));
    assert.equal(patch.ops[0].v.displayName, 'Amy');                     // the rest of her row survived the eviction
    const { rtt } = await amyWs.ping();
    assert.ok(rtt >= 0);
});

test('the host deletes the game: everyone sees it gone, and the code is free again', async () => {
    const { code, ws: host } = await newGame();
    const { ws: amy } = await join(code);
    assert.equal((await host.write([{ p: '', v: null }])).ok, true);
    const gone = await amy.next(m => m.t === 'init' && m.tree === null);
    assert.equal(gone.host, false);
    assert.deepEqual(await rt.info(code), { exists: false, phase: null, host: false });
});

test('idle rooms delete themselves once everyone has left (AUDIT M3)', async () => {
    const idle = await startRealtime({ vars: { ROOM_IDLE_MS: '300' } });
    try {
        const host = await idle.player();
        const code = await idle.reserve(host);
        const ws = await idle.connect(code, host);
        await ws.next(m => m.t === 'init');
        await ws.write([{ p: '', v: { hostUid: host.uid, state: { phase: 'lobby' } } }]);
        ws.close(1000);
        await ws.waitClosed();
        let info;
        for (let i = 0; i < 20; i++) {
            await sleep(150);
            info = await idle.info(code);
            if (!info.exists) break;
        }
        assert.equal(info.exists, false);
    } finally {
        await idle.close();
    }
});
