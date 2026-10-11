// tests/unit/router.test.mjs — worker/lib/http.js (router + JSON helpers)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, json, HttpError } from '../../worker/lib/http.js';

const req = (path, method = 'GET') => new Request(`http://local${path}`, { method });

test('matches :params and a trailing * (rest)', async () => {
    const r = createRouter();
    r.get('/api/boards/:id', ({ params }) => json(params));
    r.get('/media/*', ({ params }) => json(params));

    assert.deepEqual(await (await r.handle(req('/api/boards/pop-icons'))).json(), { id: 'pop-icons' });
    assert.deepEqual(await (await r.handle(req('/api/boards/a%20b'))).json(), { id: 'a b' });
    assert.deepEqual(await (await r.handle(req('/media/display/abc.webp'))).json(), { rest: 'display/abc.webp' });
});

test('no match → null; methods must match; HEAD uses GET routes', async () => {
    const r = createRouter();
    r.get('/api/x', () => new Response('get'));
    r.post('/api/x', () => new Response('post'));

    assert.equal(await r.handle(req('/api/y')), null);
    assert.equal(await r.handle(req('/api/x/extra')), null);
    assert.equal(await (await r.handle(req('/api/x', 'POST'))).text(), 'post');
    assert.equal(await (await r.handle(req('/api/x', 'HEAD'))).text(), 'get');
    assert.equal(await r.handle(req('/api/x', 'DELETE')), null);
});

test('regex characters in patterns are literal', async () => {
    const r = createRouter();
    r.get('/a.b', () => new Response('ok'));
    assert.equal(await r.handle(req('/aXb')), null);
    assert.ok(await r.handle(req('/a.b')));
});

test('json() defaults to no-store but keeps explicit headers', () => {
    assert.equal(json({}).headers.get('Cache-Control'), 'no-store');
    assert.equal(json({}, { headers: { 'Cache-Control': 'max-age=5' } }).headers.get('Cache-Control'), 'max-age=5');
    assert.equal(json({}, { status: 404 }).status, 404);
});

test('HttpError carries status + code', () => {
    const e = new HttpError(409, 'title_taken', 'Taken');
    assert.equal(e.status, 409);
    assert.equal(e.code, 'title_taken');
    assert.equal(e.message, 'Taken');
});
