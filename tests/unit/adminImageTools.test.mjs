// tests/unit/adminImageTools.test.mjs — src/admin/lib/imageTools.js pure parts:
// recognizing our OWN stored pictures in a dropped/pasted link (reused as they
// are — the link importer refuses this site's own address).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownPictureSha, readTransfer } from '../../src/admin/lib/imageTools.js';

const SHA = 'ab'.repeat(32);
const ORIGIN = 'http://localhost:3000';

test('ownPictureSha: our /media display + thumb links → the picture’s hash', () => {
    assert.equal(ownPictureSha(`${ORIGIN}/media/display/${SHA}.webp`, ORIGIN), SHA);
    assert.equal(ownPictureSha(`${ORIGIN}/media/thumb/${SHA}.webp`, ORIGIN), SHA);
    assert.equal(ownPictureSha(`/media/display/${SHA}.jpg`, ORIGIN), SHA);          // relative
});

test('ownPictureSha: anything else is not ours', () => {
    assert.equal(ownPictureSha(`https://elsewhere.example/media/display/${SHA}.webp`, ORIGIN), null);
    assert.equal(ownPictureSha(`${ORIGIN}/media/archive/${SHA}`, ORIGIN), null);       // private prefixes aren't links
    assert.equal(ownPictureSha(`${ORIGIN}/media/display/${SHA.slice(2)}.webp`, ORIGIN), null);
    assert.equal(ownPictureSha(`${ORIGIN}/api/boards`, ORIGIN), null);
    assert.equal(ownPictureSha('not a url ::', ORIGIN), null);
});

test('readTransfer: a dropped link comes back as { url }', () => {
    const dt = { files: [], items: [], getData: (type) => (type === 'text/uri-list' ? `# comment\n${ORIGIN}/media/display/${SHA}.webp` : '') };
    assert.deepEqual(readTransfer(dt), { url: `${ORIGIN}/media/display/${SHA}.webp` });
    assert.equal(readTransfer({ files: [], items: [], getData: () => 'just words' }), null);
    assert.equal(readTransfer(null), null);
});
