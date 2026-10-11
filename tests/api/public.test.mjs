// tests/api/public.test.mjs — what players' browsers call: /api/health,
// /api/boards, /api/boards/:id, /media/* (worker/routes/public.js).
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestEnv, storeTestImage, fullDraft } from './_harness.mjs';
import { createBoard, publishBoard } from '../../worker/lib/boards.js';

let t;
let published;   // board row (published)
let cc0Image;    // images row
let byImage;     // images row (CC BY → credit)

before(async () => {
    t = await startTestEnv();
    cc0Image = await storeTestImage(t.env, 1, { license: 'cc0', provider: 'test' });
    byImage = await storeTestImage(t.env, 2, { license: 'cc-by-4.0', creator: 'Jane Doe' });

    published = await createBoard(t.env, {
        title: 'Spooky Season', emoji: '🎃', description: 'Things that go bump',
        draft: fullDraft([cc0Image.id, byImage.id]), actor: 'test',
    });
    await publishBoard(t.env, published.id, { actor: 'test' });

    // A draft board must never be visible to players.
    await createBoard(t.env, { title: 'Secret Draft', draft: fullDraft([cc0Image.id]), actor: 'test' });
});

after(() => t?.dispose());

test('GET /api/health reports the database', async () => {
    const res = await t.fetch('/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, boards: 2 });
});

test('GET /api/boards lists published boards only, never cached', async () => {
    const res = await t.fetch('/api/boards');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    const { boards } = await res.json();
    assert.deepEqual(boards.map(b => b.title), ['Spooky Season']);
    assert.deepEqual(Object.keys(boards[0]).sort(), ['description', 'emoji', 'id', 'published_at', 'rev', 'slug', 'title']);
    assert.equal(boards[0].slug, 'spooky-season');
    assert.equal(boards[0].emoji, '🎃');
});

test('GET /api/boards/:id returns the snapshot by id or slug', async () => {
    for (const key of [published.id, 'spooky-season']) {
        const res = await t.fetch(`/api/boards/${key}`);
        assert.equal(res.status, 200, key);
        const snap = await res.json();
        assert.equal(snap.title, 'Spooky Season');
        assert.equal(snap.rev, 1);
        assert.equal(snap.categories.length, 5);
        for (const cat of snap.categories) assert.equal(cat.tiles.length, 5);

        const [first, second] = snap.categories[0].tiles;
        assert.match(first.image.url, /^\/media\/display\/[0-9a-f]{64}\.webp$/);
        assert.match(first.image.thumb, /^\/media\/thumb\/[0-9a-f]{64}\.webp$/);
        assert.equal(first.credit, null);                    // CC0
        assert.equal(second.credit, 'Jane Doe · CC BY 4.0'); // CC BY needs credit
        assert.equal(first.answer, 'Answer 0-0');
    }
});

test('unpublished or unknown boards are 404', async () => {
    assert.equal((await t.fetch('/api/boards/secret-draft')).status, 404);
    const res = await t.fetch('/api/boards/nope');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not_found' });
});

test('GET /media/display/* serves the WebP, cacheable forever, with 304s', async () => {
    const url = `/media/${cc0Image.display_key}`;
    const res = await t.fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'image/webp');
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    const etag = res.headers.get('ETag');
    assert.ok(etag);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.equal(bytes.byteLength, cc0Image.bytes);
    assert.equal(String.fromCharCode(...bytes.slice(8, 12)), 'WEBP');

    const again = await t.fetch(url, { headers: { 'If-None-Match': etag } });
    assert.equal(again.status, 304);

    const head = await t.fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('private media (archive/, evidence/) and odd paths are never served', async () => {
    assert.ok(cc0Image.archive_key?.startsWith('archive/'));
    assert.equal((await t.fetch(`/media/${cc0Image.archive_key}`)).status, 404);
    assert.equal((await t.fetch('/media/evidence/x.png')).status, 404);
    assert.equal((await t.fetch('/media/display/../archive/x')).status, 404);
    assert.equal((await t.fetch('/media/display/missing.webp')).status, 404);
});

test('unknown API routes are JSON 404s', async () => {
    const res = await t.fetch('/api/nope');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not_found' });
});
