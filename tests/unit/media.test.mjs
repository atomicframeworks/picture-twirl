// tests/unit/media.test.mjs — byte sniffing + header sizes (worker/lib/media.js),
// link-import guards (worker/lib/fetchImage.js) and session crypto
// (worker/lib/auth.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { sniffImage, imageSize } from '../../worker/lib/media.js';
import { isPrivateHost, checkUrl, extractPageImage } from '../../worker/lib/fetchImage.js';
import { safeEqual, signSession, verifySession, readCookie } from '../../worker/lib/auth.js';

const make = (fmt, w, h, opts = {}) =>
    sharp({ create: { width: w, height: h, channels: 3, background: '#3a7' } })[fmt](opts).toBuffer().then(b => new Uint8Array(b));

test('sniffImage recognizes real formats and ignores declared types', async () => {
    assert.equal(sniffImage(await make('jpeg', 10, 10)), 'image/jpeg');
    assert.equal(sniffImage(await make('png', 10, 10)), 'image/png');
    assert.equal(sniffImage(await make('webp', 10, 10)), 'image/webp');
    assert.equal(sniffImage(await make('gif', 10, 10)), 'image/gif');
    assert.equal(sniffImage(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg+xml');
    assert.equal(sniffImage(new TextEncoder().encode('<html><body>nope</body></html>')), null);
    assert.equal(sniffImage(new Uint8Array(3)), null);
});

test('imageSize reads WebP (lossy, lossless, extended), JPEG and PNG headers', async () => {
    assert.deepEqual(imageSize(await make('webp', 321, 123)), { width: 321, height: 123 });
    assert.deepEqual(imageSize(await make('webp', 300, 200, { lossless: true })), { width: 300, height: 200 });
    const extended = new Uint8Array(await sharp({ create: { width: 77, height: 55, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).webp().toBuffer());
    assert.deepEqual(imageSize(extended), { width: 77, height: 55 });
    assert.deepEqual(imageSize(await make('jpeg', 640, 480)), { width: 640, height: 480 });
    assert.deepEqual(imageSize(await make('png', 17, 9)), { width: 17, height: 9 });
    assert.equal(imageSize(new Uint8Array(20)), null);
});

test('isPrivateHost blocks loopback, private, link-local and metadata hosts', () => {
    for (const h of ['localhost', 'foo.localhost', 'printer.local', 'db.internal', '127.0.0.1', '10.1.2.3', '192.168.0.1',
        '172.16.5.5', '172.31.255.255', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', '::1', 'fd12:3456::1', 'fe80::1', '::ffff:10.0.0.1']) {
        assert.equal(isPrivateHost(h), true, h);
    }
    for (const h of ['example.com', 'upload.wikimedia.org', '8.8.8.8', '172.32.0.1', '100.128.0.1']) {
        assert.equal(isPrivateHost(h), false, h);
    }
});

test('checkUrl accepts http(s) public URLs only', () => {
    assert.equal(checkUrl(' https://example.com/a.png ').hostname, 'example.com');
    assert.throws(() => checkUrl('ftp://example.com'), { code: 'bad_url' });
    assert.throws(() => checkUrl('http://127.0.0.1'), { code: 'bad_host' });
});

test('extractPageImage finds og:image / twitter:image / image_src and resolves relative URLs', () => {
    const base = 'https://site.example/photos/42';
    assert.equal(extractPageImage('<meta property="og:image" content="/img/a.jpg?x=1&amp;y=2">', base), 'https://site.example/img/a.jpg?x=1&y=2');
    assert.equal(extractPageImage(`<meta content='https://cdn.example/b.png' property='og:image:secure_url'>`, base), 'https://cdn.example/b.png');
    assert.equal(extractPageImage('<meta name="twitter:image" content="c.webp">', base), 'https://site.example/photos/c.webp');
    assert.equal(extractPageImage('<link rel="image_src" href="//cdn.example/d.gif">', base), 'https://cdn.example/d.gif');
    assert.equal(extractPageImage('<p>no pictures</p>', base), null);
});

test('session tokens: sign → verify; tamper, wrong secret or expiry → null', async () => {
    const env = { ADMIN_PASSWORD: 'pw', SESSION_SECRET: 'secret-one' };
    const token = await signSession(env, { name: 'Kim' });
    const s = await verifySession(env, token);
    assert.equal(s.name, 'Kim');
    assert.ok(s.exp > Date.now());

    // Any change to the signature — even one that decodes to the same bytes — or to the payload fails.
    const sigStart = token.indexOf('.') + 1;
    for (const pos of [sigStart, Math.floor((sigStart + token.length) / 2), token.length - 1]) {   // first, middle, last
        const flipped = token.slice(0, pos) + (token[pos] === 'A' ? 'B' : 'A') + token.slice(pos + 1);
        assert.equal(await verifySession(env, flipped), null, `signature char ${pos}`);
    }
    assert.equal(await verifySession(env, token.replace(/^./, c => (c === 'e' ? 'f' : 'e'))), null, 'payload');
    assert.equal(await verifySession({ ...env, SESSION_SECRET: 'secret-two' }, token), null);
    assert.equal(await verifySession(env, await signSession(env, { name: 'Old' }, Date.now() - 8 * 24 * 3600 * 1000)), null);
    assert.equal(await verifySession(env, 'garbage'), null);
    assert.equal(await verifySession({ SESSION_SECRET: 'secret-one' }, token), null); // admin not configured
});

test('safeEqual + readCookie', async () => {
    assert.equal(await safeEqual('abc', 'abc'), true);
    assert.equal(await safeEqual('abc', 'abd'), false);
    assert.equal(await safeEqual('', 'x'), false);
    const req = new Request('http://x', { headers: { Cookie: 'a=1; pt_admin=tok%3Den; b=2' } });
    assert.equal(readCookie(req, 'pt_admin'), 'tok=en');
    assert.equal(readCookie(req, 'missing'), '');
});
