// tests/unit/realtimeClient.test.mjs — src/realtime/client.js connection
// handling, driven by a fake WebSocket whose timing the test controls (the
// integration tests in tests/realtime/ can't hold a socket in "connecting").
//   • clock-sync pings scheduled for one socket never touch the next one
//     (found by the M5 fresh-clone rehearsal: "InvalidStateError: Sent before
//     connected" after a quick drop + reconnect)
//   • writes made while (re)connecting go out once the room's init arrives, in order
//   • "no such game" (close 4404) stops reconnecting and fails what's waiting
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

class FakeSocket {
    static all = [];

    constructor(url) {
        this.url = String(url);
        this.readyState = 0;                         // CONNECTING until the test opens it
        this.sent = [];
        this.listeners = {};
        FakeSocket.all.push(this);
    }

    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }

    emit(type, ev) { for (const fn of this.listeners[type] || []) fn(ev); }

    send(data) {
        if (this.readyState !== 1) {                 // what browsers (and Node) do
            const err = new Error('Sent before connected.');
            err.name = 'InvalidStateError';
            throw err;
        }
        this.sent.push(JSON.parse(data));
    }

    close(code = 1000) {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.emit('close', { code });
    }

    open() { this.readyState = 1; this.emit('open', {}); }

    receive(msg) { this.emit('message', { data: JSON.stringify(msg) }); }
}

globalThis.WebSocket = FakeSocket;
globalThis.window = { location: { href: 'http://localhost:3000/' } };
globalThis.fetch = async () => ({ ok: true, status: 201, json: async () => ({ uid: 'p_aaaaaaaaaaaaaaaa', token: 'p_aaaaaaaaaaaaaaaa.sig' }) });
const client = await import('../../src/realtime/client.js');
after(() => client._internal.shutdown());

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(cond, ms = 3000) {
    const t0 = Date.now();
    while (!cond()) {
        if (Date.now() - t0 > ms) throw new Error('timed out');
        await sleep(5);
    }
}
const init = (s) => s.receive({ t: 'init', tree: null, uid: 'p_aaaaaaaaaaaaaaaa', host: false, now: Date.now() });

test('pings scheduled for one socket never touch the next one while it connects', async () => {
    const r = client.room('ping01');
    await until(() => FakeSocket.all.some(s => s.url.includes('/ping01/')));
    const first = FakeSocket.all.find(s => s.url.includes('/ping01/'));
    assert.match(first.url, /^ws:\/\/localhost:3000\/api\/rooms\/ping01\/ws\?token=.+&cid=pg_/);
    first.open();
    init(first);
    assert.equal(first.sent.filter(m => m.t === 'ping').length, 1, 'clock sync starts at once');

    first.close(4000);                                         // dropped right away
    await until(() => FakeSocket.all.filter(s => s.url.includes('/ping01/')).length === 2);
    const second = FakeSocket.all.filter(s => s.url.includes('/ping01/'))[1];
    assert.equal(second.readyState, 0);                        // still connecting…
    await sleep(1300);                                         // …past the first socket's 0.4 s + 1.2 s pings
    assert.deepEqual(second.sent, []);                         // nothing sent on it, nothing thrown
    assert.equal(r.connected, false);
});

test('writes made while (re)connecting go out after the room’s init, in order, and resolve on ack', async () => {
    const r = client.room('wait01');
    const p1 = r.write([{ p: 'a', v: 1 }]);
    const p2 = r.write([{ p: 'b', v: 2 }]);
    await until(() => FakeSocket.all.some(s => s.url.includes('/wait01/')));
    const s = FakeSocket.all.find(x => x.url.includes('/wait01/'));
    s.open();
    assert.deepEqual(s.sent, []);                              // nothing before the room says hello
    init(s);
    const writes = s.sent.filter(m => m.t === 'w');
    assert.deepEqual(writes.map(m => m.ops[0].p), ['a', 'b']);
    assert.ok(writes[0].seq < writes[1].seq);
    s.receive({ t: 'ack', id: writes[0].id, ok: true });
    s.receive({ t: 'ack', id: writes[1].id, ok: false, code: 'permission_denied', message: 'Nope.' });
    await p1;
    await assert.rejects(p2, /PERMISSION_DENIED: Nope\./);
});

test('“no such game” (close 4404) stops reconnecting and fails what was waiting', async () => {
    const r = client.room('gone01');
    const pending = r.write([{ p: 'x', v: 1 }]);
    await until(() => FakeSocket.all.some(s => s.url.includes('/gone01/')));
    const s = FakeSocket.all.find(x => x.url.includes('/gone01/'));
    s.close(4404);
    await assert.rejects(pending, /NOT_FOUND/);
    await sleep(700);
    assert.equal(FakeSocket.all.filter(x => x.url.includes('/gone01/')).length, 1, 'no reconnect attempts');
});
