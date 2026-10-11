// tests/api/content.test.mjs — storing pictures and boards in D1/R2
// (worker/lib/images.js + worker/lib/boards.js).
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestEnv, storeTestImage, fullDraft } from './_harness.mjs';
import { createBoard, publishBoard, saveBoard } from '../../worker/lib/boards.js';
import { HttpError } from '../../worker/lib/http.js';

let t;
before(async () => { t = await startTestEnv(); });
after(() => t?.dispose());

test('the same picture stored twice is one row and one set of objects', async () => {
    const a = await storeTestImage(t.env, 7, { license: 'cc0' });
    const b = await storeTestImage(t.env, 7, { license: 'cc0' });
    assert.equal(a.id, b.id);
    const { n } = await t.env.DB.prepare('SELECT COUNT(*) AS n FROM images WHERE sha256 = ?').bind(a.sha256).first();
    assert.equal(n, 1);
    for (const key of [a.display_key, a.thumb_key, a.archive_key]) {
        assert.ok(await t.env.MEDIA.head(key), key);
    }
});

test('rights are assessed when a picture is stored', async () => {
    const ok = await storeTestImage(t.env, 10, { license: 'cc0' });
    const unknown = await storeTestImage(t.env, 11, {});
    const sa = await storeTestImage(t.env, 12, { license: 'cc-by-sa-4.0', flags: ['identifiable_person'] });
    const nc = await storeTestImage(t.env, 13, { license: 'cc-by-nc-4.0' });

    assert.equal(ok.rights_status, 'ok');
    assert.deepEqual(JSON.parse(ok.rights_flags), []);
    assert.equal(unknown.rights_status, 'flagged');
    assert.deepEqual(JSON.parse(unknown.rights_flags), ['rights_unknown']);
    assert.equal(sa.rights_status, 'flagged');
    assert.deepEqual(JSON.parse(sa.rights_flags).sort(), ['identifiable_person', 'share_alike']);
    assert.equal(nc.rights_status, 'blocked');
});

test('board titles are unique, ignoring case and spacing (archived included)', async () => {
    const img = await storeTestImage(t.env, 20, { license: 'cc0' });
    await createBoard(t.env, { title: 'Holiday Hoopla', draft: fullDraft([img.id]) });
    await assert.rejects(
        createBoard(t.env, { title: '  holiday   HOOPLA ', draft: fullDraft([img.id]) }),
        (err) => err instanceof HttpError && err.status === 409 && err.code === 'title_taken',
    );
    await assert.rejects(
        createBoard(t.env, { title: '   ', draft: fullDraft([img.id]) }),
        (err) => err instanceof HttpError && err.code === 'title_required',
    );
});

test('slugs stay unique when titles slugify the same', async () => {
    const img = await storeTestImage(t.env, 21, { license: 'cc0' });
    const a = await createBoard(t.env, { title: 'Logo Loco!', draft: fullDraft([img.id]) });
    const b = await createBoard(t.env, { title: 'Logo Loco?', draft: fullDraft([img.id]) });
    assert.equal(a.slug, 'logo-loco');
    assert.equal(b.slug, 'logo-loco-2');
});

test('createBoard stores counts; the publish gate blocks until ready; publish snapshots + keeps a revision', async () => {
    const flagged = await storeTestImage(t.env, 30, {});           // rights unknown → flagged
    const fine = await storeTestImage(t.env, 31, { license: 'cc0' });
    const draft = fullDraft([flagged.id, fine.id]);
    draft.categories[4].tiles[4].answer = '';                      // one tile not ready

    const board = await createBoard(t.env, { title: 'Counting', draft, actor: 'test' });
    assert.equal(board.status, 'draft');
    assert.equal(board.rev, 1);
    assert.equal(board.tiles_ready, 24);
    assert.equal(board.flagged_tiles, 13);                         // tiles 0,2,4,…,24 use the flagged picture
    assert.equal(board.published_json, null);

    // Gate: a missing answer blocks publishing (422 with the problem list).
    await assert.rejects(publishBoard(t.env, board.id, { actor: 'test' }), (err) =>
        err instanceof HttpError && err.status === 422 && err.code === 'not_ready'
        && err.details.problems.some(p => p.code === 'answer_missing' && p.cat === 4 && p.row === 4));

    // Fix it (autosave), then publish: ⚠️ flagged pictures don't block.
    draft.categories[4].tiles[4].answer = 'Finally';
    const saved = await saveBoard(t.env, board.id, { rev: 1, draft }, 'test');
    assert.equal(saved.board.rev, 2);
    assert.equal(saved.validation.ok, true);
    assert.ok(saved.validation.warnings.some(w => w.code === 'picture_flagged'));

    const snap = await publishBoard(t.env, board.id, { actor: 'test' });
    const row = await t.env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(board.id).first();
    assert.equal(row.status, 'published');
    assert.equal(row.published_rev, 2);
    assert.deepEqual(JSON.parse(row.published_json), snap);

    const rev = await t.env.DB.prepare('SELECT * FROM board_revisions WHERE board_id = ?').bind(board.id).first();
    assert.equal(rev.rev, 2);
    assert.equal(rev.published_by, 'test');

    const actions = (await t.env.DB.prepare('SELECT action FROM audit_log WHERE board_id = ? ORDER BY id').bind(board.id).all()).results.map(r => r.action);
    assert.deepEqual(actions, ['board.create', 'board.publish']);
});

test('publishing an unknown board is a 404 HttpError', async () => {
    await assert.rejects(publishBoard(t.env, 'brd_missing'), (err) => err instanceof HttpError && err.status === 404);
});
