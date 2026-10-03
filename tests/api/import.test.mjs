// tests/api/import.test.mjs — the content tools' API (worker/routes/import.js):
// bearer token, runs, picture + evidence uploads, idempotent board imports that
// never overwrite boards a person already took over.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { startTestEnv, storeTestImage, fullDraft } from './_harness.mjs';
import { normalizeImage } from '../../tools/content/lib/images.mjs';

let t;
const TOKEN = 'dev-import-token';           // .dev.vars.example
before(async () => { t = await startTestEnv(); });
after(() => t?.dispose());

async function imp(method, path, body, token = TOKEN) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    let payload = body;
    if (body !== undefined && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await t.fetch(path, { method, headers, body: payload });
    return { status: res.status, body: await res.json().catch(() => null) };
}

test('wrong or missing token → 401; routes need the token', async () => {
    assert.equal((await imp('POST', '/api/import/runs', { kind: 'sheet' }, null)).status, 401);
    assert.equal((await imp('POST', '/api/import/runs', { kind: 'sheet' }, 'nope')).status, 401);
    assert.equal((await imp('POST', '/api/import/boards', {}, 'nope')).status, 401);
});

test('runs: create, then finish with a summary', async () => {
    const created = await imp('POST', '/api/import/runs', { kind: 'discover', actor: 'AI · Kevin' });
    assert.equal(created.status, 201);
    assert.equal(created.body.run.kind, 'discover');
    assert.equal(created.body.run.actor, 'AI · Kevin');
    const done = await imp('PATCH', `/api/import/runs/${created.body.run.id}`, { summary: { boards: 2 }, finished: true });
    assert.ok(done.body.run.finished_at);
    assert.deepEqual(JSON.parse(done.body.run.summary_json), { boards: 2 });
});

test('images: stored with provenance + license; evidence kept privately', async () => {
    const png = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#5a9' } }).png().toBuffer();
    const img = await normalizeImage(png);
    const shot = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#fff' } }).png().toBuffer();
    const form = new FormData();
    form.append('display', new Blob([img.display.bytes]));
    form.append('thumb', new Blob([img.thumb.bytes]));
    form.append('archive', new Blob([img.archive.bytes]));
    form.append('evidence', new Blob([shot]));
    form.append('meta', JSON.stringify({
        provider: 'wikimedia', sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg',
        sourceFileUrl: 'https://upload.wikimedia.org/x.jpg', creator: 'Jane', license: 'cc-by-sa-4.0', flags: ['identifiable_person'],
    }));
    const res = await imp('POST', '/api/import/images', form);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const image = res.body.image;
    assert.equal(image.provider, 'wikimedia');
    assert.equal(image.license, 'cc-by-sa-4.0');
    assert.equal(image.rightsStatus, 'flagged');
    assert.deepEqual(image.rightsFlags.sort(), ['identifiable_person', 'share_alike']);
    assert.equal(image.hasEvidence, true);
    assert.equal(image.hasArchive, true);
    assert.ok(image.retrievedAt);

    // Evidence and archive are never public.
    const row = await t.env.DB.prepare('SELECT evidence_key, archive_key FROM images WHERE id = ?').bind(image.id).first();
    assert.match(row.evidence_key, /^evidence\/[0-9a-f]{64}\.png$/);
    assert.equal((await t.fetch(`/media/${row.evidence_key}`)).status, 404);
    assert.equal((await t.fetch(`/media/${row.archive_key}`)).status, 404);
});

test('boards: created as "import"; re-runs update; reviewed boards are never overwritten', async () => {
    const img = await storeTestImage(t.env, 400, { license: 'cc0' });
    const draft = fullDraft([img.id]);
    const first = await imp('POST', '/api/import/boards', {
        externalKey: 'sheet:holidays', source: 'ai-sheet', actor: 'AI · test', title: 'Holiday Hoopla', emoji: '🎉', description: 'Festive', draft,
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.action, 'created');
    assert.equal(first.body.board.status, 'import');
    assert.equal(first.body.board.source, 'ai-sheet');
    assert.equal(first.body.board.tiles_ready, 25);

    draft.categories[0].title = 'Spooky';
    const again = await imp('POST', '/api/import/boards', { externalKey: 'sheet:holidays', title: 'Holiday Hoopla', draft });
    assert.equal(again.body.action, 'updated');
    assert.equal(again.body.board.id, first.body.board.id);
    assert.equal(again.body.board.rev, 2);

    // A person publishes it → the tool must leave it alone.
    await t.env.DB.prepare(`UPDATE boards SET status = 'published' WHERE id = ?`).bind(first.body.board.id).run();
    draft.categories[0].title = 'Overwritten?';
    const kept = await imp('POST', '/api/import/boards', { externalKey: 'sheet:holidays', title: 'Holiday Hoopla', draft });
    assert.equal(kept.body.action, 'kept');
    const row = await t.env.DB.prepare('SELECT draft_json FROM boards WHERE id = ?').bind(first.body.board.id).first();
    assert.equal(JSON.parse(row.draft_json).categories[0].title, 'Spooky');
});

test('boards: a taken title gets a number instead of failing; externalKey required', async () => {
    const img = await storeTestImage(t.env, 401, { license: 'cc0' });
    const a = await imp('POST', '/api/import/boards', { externalKey: 'discover:a', source: 'ai-discover', title: 'Logo Loco', draft: fullDraft([img.id]) });
    const b = await imp('POST', '/api/import/boards', { externalKey: 'discover:b', source: 'ai-discover', title: 'logo loco', draft: fullDraft([img.id]) });
    assert.equal(a.body.board.title, 'Logo Loco');
    assert.equal(b.body.board.title, 'logo loco (2)');
    assert.equal((await imp('POST', '/api/import/boards', { title: 'X', draft: fullDraft([img.id]) })).body.error, 'external_key_required');
    assert.equal((await imp('POST', '/api/import/boards', { externalKey: 'k', title: 'Y', draft: fullDraft(['img_0000000000000000']) })).body.error, 'unknown_image');
});

test('boards listing: every board (any status) with its external key, token required', async () => {
    assert.equal((await imp('GET', '/api/import/boards', undefined, null)).status, 401);
    const img = await storeTestImage(t.env, 402, { license: 'cc0' });
    await imp('POST', '/api/import/boards', {
        externalKey: 'discover:listing-check', source: 'ai-discover', title: 'Listing Check', emoji: '🔎', draft: fullDraft([img.id]),
    });
    const res = await imp('GET', '/api/import/boards');
    assert.equal(res.status, 200);
    const row = res.body.boards.find(b => b.external_key === 'discover:listing-check');
    assert.deepEqual(Object.keys(row).sort(), ['description', 'emoji', 'external_key', 'id', 'source', 'status', 'title']);
    assert.equal(row.status, 'import');
    assert.equal(row.source, 'ai-discover');
});
