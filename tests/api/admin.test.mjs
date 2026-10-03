// tests/api/admin.test.mjs — the admin JSON API (worker/routes/admin.js):
// sign-in, sessions, CSRF/origin, boards CRUD + autosave + publish gate +
// status changes + bulk, pictures (upload / link guard / rights), stats, audit.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestEnv, storeTestImage, fullDraft } from './_harness.mjs';
import { normalizeImage } from '../../tools/content/lib/images.mjs';
import sharp from 'sharp';

let t;
let cookie;                                  // signed-in admin session
const PASSWORD = 'dev-admin-password';       // .dev.vars.example

before(async () => {
    t = await startTestEnv();
    const res = await login({ password: PASSWORD, name: 'Tester' });
    assert.equal(res.status, 200);
    cookie = res.headers.get('Set-Cookie').split(';')[0];
});
after(() => t?.dispose());

function login(body, ip = '198.51.100.1') {
    return t.fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify(body),
    });
}

/** Signed-in request helper: api('POST', '/api/admin/boards', { … }). */
async function api(method, path, body, extraHeaders = {}) {
    const headers = { Cookie: cookie, ...extraHeaders };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await t.fetch(path, { method, headers, body: payload });
    const type = res.headers.get('Content-Type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : res };
}

async function newBoard(title, extra = {}) {
    const res = await api('POST', '/api/admin/boards', { title, emoji: '🧪', ...extra });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.board;
}

/** A finished 5×5 draft using `n` fresh pictures. */
async function readyDraft(seedBase, license = 'cc0') {
    const imgs = [];
    for (let i = 0; i < 3; i++) imgs.push(await storeTestImage(t.env, seedBase + i, { license }));
    return fullDraft(imgs.map(i => i.id));
}

// ── Sessions ────────────────────────────────────────────────────────────────

test('login: wrong password 401, missing name 400; cookie is HttpOnly + SameSite=Strict', async () => {
    assert.equal((await login({ password: 'nope', name: 'X' }, '198.51.100.2')).status, 401);
    assert.equal((await login({ password: PASSWORD, name: '  ' }, '198.51.100.2')).status, 400);

    const ok = await login({ password: PASSWORD, name: 'Kim' }, '198.51.100.2');
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.get('Set-Cookie');
    assert.match(setCookie, /^pt_admin=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /Max-Age=604800/);
});

test('login is rate-limited per IP after 10 wrong passwords', async () => {
    const ip = '198.51.100.77';
    for (let i = 0; i < 10; i++) assert.equal((await login({ password: 'bad', name: 'X' }, ip)).status, 401);
    assert.equal((await login({ password: PASSWORD, name: 'X' }, ip)).status, 429);   // even the right one
    assert.equal((await login({ password: PASSWORD, name: 'X' }, '198.51.100.78')).status, 200); // other IPs fine
});

test('/me reflects the session; every admin route needs it', async () => {
    const me = await api('GET', '/api/admin/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.name, 'Tester');

    for (const [method, path] of [['GET', '/api/admin/me'], ['GET', '/api/admin/boards'], ['GET', '/api/admin/stats'],
        ['POST', '/api/admin/boards'], ['PUT', '/api/admin/boards/x'], ['POST', '/api/admin/images'], ['GET', '/api/admin/audit']]) {
        const res = await t.fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
        assert.equal(res.status, 401, `${method} ${path}`);
    }
    // A forged or tampered cookie is rejected.
    const tampered = cookie.slice(0, -3) + (cookie.endsWith('A') ? 'BBB' : 'AAA');
    assert.equal((await t.fetch('/api/admin/me', { headers: { Cookie: tampered } })).status, 401);
});

test('cross-site writes are refused (Origin check)', async () => {
    const res = await api('POST', '/api/admin/boards', { title: 'Evil' }, { Origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'bad_origin');
    const sameSite = await api('POST', '/api/admin/boards', { title: 'Origin OK' }, { Origin: 'http://localhost' });
    assert.equal(sameSite.status, 201);
});

test('logout clears the cookie', async () => {
    const res = await t.fetch('/api/admin/logout', { method: 'POST' });
    assert.match(res.headers.get('Set-Cookie'), /Max-Age=0/);
});

// ── Boards ──────────────────────────────────────────────────────────────────

test('create: blank 5×5 draft; titles unique; title check endpoint', async () => {
    const b = await newBoard('Holiday Hoopla', { description: 'Festive!' });
    assert.equal(b.status, 'draft');
    assert.equal(b.slug, 'holiday-hoopla');
    assert.equal(b.tiles_ready, 0);
    assert.equal(b.updated_by, 'Tester');

    const dup = await api('POST', '/api/admin/boards', { title: 'holiday  hoopla' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, 'title_taken');
    assert.equal((await api('POST', '/api/admin/boards', { title: '' })).status, 400);
    assert.equal((await api('POST', '/api/admin/boards', { title: 'x'.repeat(61) })).status, 400);

    const check = async (title, except) =>
        (await api('GET', `/api/admin/titles/check?title=${encodeURIComponent(title)}${except ? `&except=${except}` : ''}`)).body.available;
    assert.equal(await check('HOLIDAY HOOPLA'), false);
    assert.equal(await check('HOLIDAY HOOPLA', b.id), true);   // its own name is fine when renaming
    assert.equal(await check('Something New'), true);
});

test('get + autosave: rev increments, stale rev → 409 with current rev, renames checked', async () => {
    const b = await newBoard('Autosave Arena');
    const got = await api('GET', `/api/admin/boards/${b.id}`);
    assert.equal(got.status, 200);
    assert.equal(got.body.draft.categories.length, 5);
    assert.equal(got.body.validation.ok, false);

    const draft = got.body.draft;
    draft.categories[0].title = 'First';
    const s1 = await api('PUT', `/api/admin/boards/${b.id}`, { rev: 1, draft });
    assert.equal(s1.status, 200);
    assert.equal(s1.body.board.rev, 2);

    const stale = await api('PUT', `/api/admin/boards/${b.id}`, { rev: 1, draft });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'stale');
    assert.equal(stale.body.rev, 2);

    await newBoard('Taken Name');
    const rename = await api('PUT', `/api/admin/boards/${b.id}`, { rev: 2, title: 'taken name' });
    assert.equal(rename.status, 409);
    assert.equal(rename.body.error, 'title_taken');

    const ok = await api('PUT', `/api/admin/boards/${b.id}`, { rev: 2, title: 'Autosave Arena Deluxe', emoji: '🎯' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.board.title, 'Autosave Arena Deluxe');
    assert.equal(ok.body.board.emoji, '🎯');
    assert.equal(ok.body.board.slug, 'autosave-arena');            // slugs never change

    // Unknown picture ids are refused; malformed ones are dropped by normalizeDraft.
    draft.categories[1].tiles[0].imageId = 'img_0000000000000000';
    assert.equal((await api('PUT', `/api/admin/boards/${b.id}`, { rev: 3, draft })).body.error, 'unknown_image');
    draft.categories[1].tiles[0].imageId = '../../etc';
    const cleaned = await api('PUT', `/api/admin/boards/${b.id}`, { rev: 3, draft });
    assert.equal(cleaned.status, 200);
    assert.equal((await api('GET', `/api/admin/boards/${b.id}`)).body.draft.categories[1].tiles[0].imageId, null);
});

test('publish gate → publish → visible to players; unpublish / archive / restore', async () => {
    const b = await newBoard('Gatekeeper');
    const notReady = await api('POST', `/api/admin/boards/${b.id}/publish`);
    assert.equal(notReady.status, 422);
    assert.equal(notReady.body.error, 'not_ready');
    assert.ok(notReady.body.problems.length >= 25);

    const draft = await readyDraft(100);
    const saved = await api('PUT', `/api/admin/boards/${b.id}`, { rev: 1, draft });
    assert.equal(saved.body.validation.ok, true);
    assert.equal(saved.body.board.tiles_ready, 25);

    const pub = await api('POST', `/api/admin/boards/${b.id}/publish`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.board.status, 'published');
    assert.equal(pub.body.board.unpublished_changes, false);
    assert.ok((await (await t.fetch('/api/boards')).json()).boards.some(x => x.id === b.id));

    // Editing a published board → "unpublished changes"; players keep the old snapshot.
    draft.categories[0].title = 'Renamed Column';
    const edit = await api('PUT', `/api/admin/boards/${b.id}`, { rev: 2, draft });
    assert.equal(edit.body.board.unpublished_changes, true);
    assert.equal((await (await t.fetch(`/api/boards/${b.id}`)).json()).categories[0].title, 'Category 1');
    await api('POST', `/api/admin/boards/${b.id}/publish`);
    assert.equal((await (await t.fetch(`/api/boards/${b.id}`)).json()).categories[0].title, 'Renamed Column');

    const unpub = await api('POST', `/api/admin/boards/${b.id}/unpublish`);
    assert.equal(unpub.body.board.status, 'draft');
    assert.equal((await t.fetch(`/api/boards/${b.id}`)).status, 404);

    const arch = await api('POST', `/api/admin/boards/${b.id}/archive`);
    assert.equal(arch.body.board.status, 'archived');
    assert.equal((await api('PUT', `/api/admin/boards/${b.id}`, { rev: 3, draft })).status, 409);       // archived: read-only
    assert.equal((await api('POST', `/api/admin/boards/${b.id}/publish`)).status, 409);
    assert.equal((await api('POST', `/api/admin/boards/${b.id}/unpublish`)).body.error, 'invalid_transition');

    const restored = await api('POST', `/api/admin/boards/${b.id}/restore`);
    assert.equal(restored.body.board.status, 'draft');
});

test('duplicate makes a unique "Copy of …" draft', async () => {
    const b = await newBoard('Twin Peaks');
    const c1 = await api('POST', `/api/admin/boards/${b.id}/duplicate`);
    const c2 = await api('POST', `/api/admin/boards/${b.id}/duplicate`);
    assert.equal(c1.body.board.title, 'Copy of Twin Peaks');
    assert.equal(c2.body.board.title, 'Copy of Twin Peaks (2)');
    assert.equal(c2.body.board.status, 'draft');
});

test('bulk: publishes what is ready, skips the rest with reasons', async () => {
    const ready = await newBoard('Bulk Ready');
    await api('PUT', `/api/admin/boards/${ready.id}`, { rev: 1, draft: await readyDraft(200) });
    const empty = await newBoard('Bulk Empty');

    const res = await api('POST', '/api/admin/boards/bulk', { action: 'publish', ids: [ready.id, empty.id, 'brd_missing'] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.done, [ready.id]);
    assert.deepEqual(res.body.skipped.map(s => [s.id, s.code]), [[empty.id, 'not_ready'], ['brd_missing', 'not_found']]);

    const arch = await api('POST', '/api/admin/boards/bulk', { action: 'archive', ids: [ready.id, empty.id] });
    assert.deepEqual(arch.body.done.sort(), [ready.id, empty.id].sort());
    assert.equal((await api('POST', '/api/admin/boards/bulk', { action: 'explode', ids: [ready.id] })).status, 400);
    assert.equal((await api('POST', '/api/admin/boards/bulk', { action: 'archive', ids: [] })).status, 400);
});

test('list + stats + audit reflect what happened', async () => {
    const list = await api('GET', '/api/admin/boards');
    assert.ok(list.body.boards.length >= 5);
    assert.ok(list.body.boards.every(b => !('draft_json' in b) && !('published_json' in b)));

    const stats = (await api('GET', '/api/admin/stats')).body;
    const total = Object.values(stats.counts).reduce((a, b) => a + b, 0);
    assert.equal(total, list.body.boards.length);
    assert.equal(stats.totals.boards, total);
    assert.ok(stats.totals.pictures > 0);
    assert.ok(Array.isArray(stats.recent) && stats.recent.length > 0);

    const audit = (await api('GET', '/api/admin/audit?limit=200')).body.entries;
    const actions = new Set(audit.map(a => a.action));
    for (const a of ['board.create', 'board.publish', 'board.unpublish', 'board.archive', 'board.restore', 'board.rename']) {
        assert.ok(actions.has(a), a);
    }
    assert.ok(audit.every(a => a.actor === 'Tester'));
});

// ── Pictures ────────────────────────────────────────────────────────────────

async function uploadForm(seed, meta) {
    const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: seed, g: 120, b: 200 } } }).png().toBuffer();
    const img = await normalizeImage(png);
    const form = new FormData();
    form.append('display', new Blob([img.display.bytes], { type: 'image/webp' }), 'display.webp');
    form.append('thumb', new Blob([img.thumb.bytes], { type: 'image/webp' }), 'thumb.webp');
    if (meta) form.append('meta', JSON.stringify(meta));
    return { form, img };
}

test('upload: stores a WebP pair with dimensions read from the file; dedupes', async () => {
    const { form, img } = await uploadForm(5, { provider: 'url', sourceFileUrl: 'https://example.com/cat.jpg', license: 'cc-by-4.0', creator: 'Jane' });
    const res = await api('POST', '/api/admin/images', form);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const image = res.body.image;
    assert.equal(image.width, img.display.width);
    assert.equal(image.height, img.display.height);
    assert.equal(image.provider, 'url');
    assert.equal(image.sourceFileUrl, 'https://example.com/cat.jpg');
    assert.ok(image.retrievedAt);
    assert.equal(image.rightsStatus, 'ok');
    assert.match(image.url, /^\/media\/display\/[0-9a-f]{64}\.webp$/);
    assert.equal((await t.fetch(image.url)).status, 200);

    const again = await api('POST', '/api/admin/images', (await uploadForm(5)).form);
    assert.equal(again.body.image.id, image.id);
});

test('upload: refuses missing, non-WebP/JPEG, oversized or disguised files', async () => {
    const empty = new FormData();
    assert.equal((await api('POST', '/api/admin/images', empty)).body.error, 'file_missing');

    const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#f00' } }).png().toBuffer();
    const form = new FormData();
    form.append('display', new Blob([png], { type: 'image/webp' }));   // lies about its type
    form.append('thumb', new Blob([png], { type: 'image/webp' }));
    assert.equal((await api('POST', '/api/admin/images', form)).body.error, 'bad_file_type');

    const big = await sharp({ create: { width: 2000, height: 100, channels: 3, background: '#0f0' } }).webp().toBuffer();
    const thumb = await sharp({ create: { width: 100, height: 10, channels: 3, background: '#0f0' } }).webp().toBuffer();
    const tooWide = new FormData();
    tooWide.append('display', new Blob([big]));
    tooWide.append('thumb', new Blob([thumb]));
    assert.equal((await api('POST', '/api/admin/images', tooWide)).body.error, 'image_too_big');
});

test('picture links: bad schemes and private hosts are refused before any fetch', async () => {
    for (const url of ['notaurl', 'ftp://example.com/a.png', 'file:///etc/passwd', 'javascript:alert(1)']) {
        assert.equal((await api('POST', '/api/admin/images/fetch', { url })).body.error, 'bad_url', url);
    }
    for (const url of ['http://localhost/a.png', 'http://127.0.0.1/a.png', 'http://192.168.1.10/a.png', 'http://[::1]/a.png', 'http://169.254.169.254/latest/meta-data']) {
        assert.equal((await api('POST', '/api/admin/images/fetch', { url })).body.error, 'bad_host', url);
    }
});

test('rights edits recompute status and the ⚠️ counts of boards using the picture', async () => {
    const img = await storeTestImage(t.env, 300, { license: 'cc0' });
    const b = await newBoard('Rights Recount');
    const draft = fullDraft([img.id]);
    await api('PUT', `/api/admin/boards/${b.id}`, { rev: 1, draft });
    const before = (await api('GET', `/api/admin/boards/${b.id}`)).body.board;
    assert.equal(before.flagged_tiles, 0);

    const patched = await api('PATCH', `/api/admin/images/${img.id}`, {
        license: 'cc-by-sa-4.0', creator: 'Sam', flags: ['trademark', 'bogus'], sourcePageUrl: 'javascript:bad', reviewed: true,
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.image.rightsStatus, 'flagged');
    assert.deepEqual(patched.body.image.rightsFlags.sort(), ['share_alike', 'trademark']);
    assert.equal(patched.body.image.sourcePageUrl, null);           // non-http URL dropped
    assert.equal(patched.body.image.reviewedBy, 'Tester');

    const after = (await api('GET', `/api/admin/boards/${b.id}`)).body.board;
    assert.equal(after.flagged_tiles, 25);

    const blocked = await api('PATCH', `/api/admin/images/${img.id}`, { license: 'cc-by-nc-4.0' });
    assert.equal(blocked.body.image.rightsStatus, 'blocked');
    const check = (await api('GET', `/api/admin/boards/${b.id}`)).body.validation;
    assert.ok(check.problems.some(p => p.code === 'picture_blocked'));
});
