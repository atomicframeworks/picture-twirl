// tests/realtime/client.test.mjs — the browser's realtime layer (src/realtime/
// client.js + db.js, the Firebase-shaped API the game calls) running in Node
// against the real Worker + GameRoom in local workerd. Proves the shim keeps
// Firebase's behavior: values + change events, set/update/remove/push,
// serverTimestamp/increment, refused writes, onDisconnect, '.info/connected',
// clock offset, and reconnect + catch-up with writes made while offline.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, startRealtime } from './_harness.mjs';

let rt;
let db;
let client;

before(async () => {
    rt = await startRealtime();
    // What the shim needs from a browser: a location and a relative-URL fetch.
    globalThis.window = { location: { href: `${rt.base}/` } };
    const realFetch = globalThis.fetch;
    globalThis.fetch = (u, init) => realFetch(new URL(String(u), rt.base), init);
    db = await import('../../src/realtime/db.js');
    client = await import('../../src/realtime/client.js');
});

after(async () => {
    client?._internal.shutdown();
    await rt?.close();
});

/** Collect what a listener sees. */
function watch(reference) {
    const seen = [];
    const off = db.onValue(reference, (snap) => seen.push(snap.val()));
    return {
        seen,
        off,
        async until(pred, ms = 3000) {
            const t0 = Date.now();
            while (Date.now() - t0 < ms) {
                const hit = seen.find(pred);
                if (hit !== undefined) return hit;
                await sleep(20);
            }
            throw new Error(`listener never saw it; saw ${JSON.stringify(seen).slice(0, 300)}`);
        },
    };
}

async function hostedGame() {
    const me = await client.requireAuth();
    const code = await client.reserveGameCode();
    const { ref, set, serverTimestamp } = db;
    await set(ref(client.rtdb, `games/${code}`), {
        hostUid: me.uid, title: 'Shim test', createdAt: serverTimestamp(), state: { phase: 'lobby' }, scores: { A: 0, B: 0 },
        participants: { [me.uid]: { displayName: 'GM', team: 'none', isGM: true } },
    });
    return { me, code };
}

test('identity: requireAuth creates one; getCurrentUser returns it', async () => {
    assert.equal(client.getCurrentUser(), null);
    const me = await client.requireAuth();
    assert.match(me.uid, /^p_[0-9a-z]{16}$/);
    assert.deepEqual(client.getCurrentUser(), { uid: me.uid, isAnonymous: true });
    assert.deepEqual(await client.requireAuth(), client.getCurrentUser());
});

test('create a game with set(); get() and room info agree; we are its host', async () => {
    const { me, code } = await hostedGame();
    const snap = await db.get(db.ref(client.rtdb, `games/${code}`));
    assert.equal(snap.exists(), true);
    assert.equal(snap.val().hostUid, me.uid);
    assert.equal(typeof snap.val().createdAt, 'number');          // serverTimestamp resolved by the room
    assert.equal(snap.child('state/phase').val(), 'lobby');
    assert.deepEqual(await client.getRoomInfo(code), { exists: true, phase: 'lobby', host: true });
    assert.equal(await client.gameExists(code), true);
    assert.equal(await client.gameExists('zzzzzz'), false);
});

test('onValue: current value first, then only when ITS location changes; other players’ writes arrive', async () => {
    const { code } = await hostedGame();
    const scores = watch(db.ref(client.rtdb, `games/${code}/scores`));
    const title = watch(db.ref(client.rtdb, `games/${code}/title`));
    await scores.until(v => v?.A === 0);
    await title.until(v => v === 'Shim test');

    await db.update(db.ref(client.rtdb, `games/${code}`), { 'scores/A': db.increment(100), [`gameIndex/${code}`]: true });
    await scores.until(v => v?.A === 100);
    assert.equal(title.seen.length, 1, 'an unrelated change does not fire the title listener');

    // Someone else joins over a raw socket — our participants listener hears it.
    const parts = watch(db.ref(client.rtdb, `games/${code}/participants`));
    const amy = await rt.player();
    const ws = await rt.connect(code, amy);
    await ws.next(m => m.t === 'init');
    await ws.write([{ p: `participants/${amy.uid}`, v: { displayName: 'Amy', team: 'none', isGM: false } }]);
    await parts.until(v => v?.[amy.uid]?.displayName === 'Amy');
    scores.off(); title.off(); parts.off();
});

test('set / update / remove / push behave like Firebase; snapshots iterate in key order', async () => {
    const { code } = await hostedGame();
    const { ref, set, update, remove, push, get } = db;
    const base = `games/${code}`;
    await set(ref(client.rtdb, `${base}/teams`), { B: { name: 'Blue' }, A: { name: 'Red' } });
    await update(ref(client.rtdb, base), { 'teams/A/name': 'Crimson', 'settings/teamsEnabled': true });
    const teams = await get(ref(client.rtdb, `${base}/teams`));
    assert.deepEqual(teams.val(), { A: { name: 'Crimson' }, B: { name: 'Blue' } });
    const keys = [];
    teams.forEach(c => { keys.push(c.key); });
    assert.deepEqual(keys, ['A', 'B']);

    const first = push(ref(client.rtdb, `${base}/log`));
    await set(first, { n: 1 });
    await push(ref(client.rtdb, `${base}/log`), { n: 2 });
    const log = await get(ref(client.rtdb, `${base}/log`));
    const order = [];
    log.forEach(c => { order.push(c.val().n); });
    assert.deepEqual(order, [1, 2]);                                 // push ids sort by time

    await remove(ref(client.rtdb, `${base}/log`));
    assert.equal((await get(ref(client.rtdb, `${base}/log`))).exists(), false);
});

test('a refused write rejects with the room’s reason; nothing changes', async () => {
    const amyGame = await hostedGame();
    // Play as a stranger: a different identity can't take over the host's row.
    const other = await rt.player();
    const ws = await rt.connect(amyGame.code, other);
    await ws.next(m => m.t === 'init');
    const res = await ws.write([{ p: 'hostUid', v: other.uid }]);
    assert.equal(res.code, 'permission_denied');
    // And the shim surfaces refusals as rejected promises:
    await assert.rejects(db.set(db.ref(client.rtdb, 'games/zzzzzz/title'), 'x'), /PERMISSION_DENIED/);   // no such game
    await assert.rejects(db.set(db.ref(client.rtdb, 'games/not-a-code!/title'), 'x'), /unsupported path/);
});

test('onDisconnect: actions run when this page leaves; cancel() removes them', async () => {
    const { me, code } = await hostedGame();
    const hostRow = db.ref(client.rtdb, `games/${code}/participants/${me.uid}`);
    await db.onDisconnect(db.ref(client.rtdb, `games/${code}/note`)).set('cancelled — must not appear');
    await db.onDisconnect(db.ref(client.rtdb, `games/${code}/note`)).cancel();
    await db.onDisconnect(hostRow).update({ online: false, lastSeen: db.serverTimestamp() });

    const observer = await rt.connect(code, await rt.player());
    await observer.next(m => m.t === 'init');
    client._internal.rooms.get(code).leave();                       // like closing the tab
    const patch = await observer.next(m => m.t === 'patch' && m.ops.some(o => o.p === `participants/${me.uid}` && o.v?.online === false));
    assert.equal(typeof patch.ops[0].v.lastSeen, 'number');
    assert.equal(await observer.none(m => m.t === 'patch' && m.ops.some(o => o.p === 'note')), null);
});

test('.info/connected + clock offset; reconnect catches up, writes made while offline still land', async () => {
    const { code } = await hostedGame();
    const connected = [];
    const offConn = db.onValue(db.ref(client.rtdb, '.info/connected'), (s) => connected.push(s.val()));
    const offset = await db.get(db.ref(client.rtdb, '.info/serverTimeOffset'));
    assert.equal(typeof offset.val(), 'number');
    assert.ok(Math.abs(offset.val()) < 1000, `local clock offset ${offset.val()} ms`);
    for (let i = 0; i < 50 && connected.at(-1) !== true; i++) await sleep(20);
    assert.equal(connected.at(-1), true);

    // The room drops every socket (as if it moved / the network blinked).
    await rt.worker().evictDurableObject('ROOMS', { name: code, webSockets: 'close' });
    for (let i = 0; i < 100 && !connected.includes(false); i++) await sleep(20);
    assert.ok(connected.includes(false), 'saw the disconnect');
    const pending = db.update(db.ref(client.rtdb, `games/${code}`), { 'state/phase': 'live' });   // made while offline
    for (let i = 0; i < 200 && connected.at(-1) !== true; i++) await sleep(25);
    assert.equal(connected.at(-1), true, 'reconnected by itself');
    await pending;
    assert.equal((await client.getRoomInfo(code)).phase, 'live');
    const stats = client.realtimeStats().find(s => s.code === code);
    assert.ok(stats.reconnects >= 1);
    assert.ok(stats.bestRttMs !== null && stats.bestRttMs < 1000, JSON.stringify(stats));
    offConn();
});

test('a drop right after connecting is harmless (clock-sync pings belong to their own socket)', async () => {
    const { code } = await hostedGame();
    const r = client._internal.rooms.get(code);
    // Drop again the moment each reconnect lands, while that socket's quick
    // follow-up pings (0.4 s / 1.2 s) are still scheduled. They used to fire on
    // the NEXT socket while it was still connecting → "InvalidStateError".
    const until = async (cond) => { for (let i = 0; i < 400 && !cond(); i++) await sleep(5); };
    const before = r.stats.reconnects;
    for (let round = 0; round < 3; round++) {
        await until(() => r.connected);                  // a (re)connect just landed: its pings are scheduled
        client.simulateDrop();
        await until(() => !r.connected);
    }
    await until(() => r.connected);
    await sleep(1500);                                   // past every scheduled ping
    assert.equal(r.connected, true);
    assert.ok(r.stats.reconnects - before >= 3, `reconnects: ${r.stats.reconnects - before}`);
});
