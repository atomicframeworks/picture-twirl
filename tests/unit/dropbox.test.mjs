// tests/unit/dropbox.test.mjs — scripts/lib/dropbox.mjs: setup notices the repo
// is inside a Dropbox folder (a `.dropbox` file in a parent) and then keeps
// node_modules / .wrangler / dist out of sync on that machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PER_MACHINE, findDropboxRoot } from '../../scripts/lib/dropbox.mjs';

const fakeFs = (...files) => (p) => files.includes(path.resolve(p));

test('finds the Dropbox folder above the project (macOS- and Windows-style trees)', () => {
    const root = path.resolve('/Users/me/Dropbox');
    assert.equal(findDropboxRoot(path.join(root, 'Server', 'picture-twirl'), fakeFs(path.join(root, '.dropbox'))), root);
    assert.equal(findDropboxRoot(root, fakeFs(path.join(root, '.dropbox'))), root);
});

test('not inside Dropbox → null (a GitHub clone elsewhere: nothing to do)', () => {
    assert.equal(findDropboxRoot(path.resolve('/home/lu/code/picture-twirl'), fakeFs()), null);
});

test('the per-machine folders: dependencies, the local database, build output', () => {
    assert.deepEqual(PER_MACHINE, ['node_modules', '.wrangler', 'dist']);
});
