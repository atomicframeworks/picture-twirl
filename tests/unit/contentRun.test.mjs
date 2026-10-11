// tests/unit/contentRun.test.mjs — tools/content/lib/run.mjs siteState(): a run
// remembers what it uploaded per site, so a run first uploaded to the local site
// and later to production (`--resume … --live --site prod`) uploads its pictures
// again there instead of pointing production boards at local picture ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteState } from '../../tools/content/lib/run.mjs';

test('a run from before the split: its top-level upload state was the local site', () => {
    const state = { kind: 'sheet', tiles: { t: 1 }, runId: 'run-local', uploads: { sha1: 'img-local' }, boards: { b: { id: 'board-local' } } };
    const prod = siteState(state, 'prod');
    assert.deepEqual(prod, { runId: null, uploads: {}, boards: {} });                  // production starts clean
    assert.deepEqual(state.sites.local, { runId: 'run-local', uploads: { sha1: 'img-local' }, boards: { b: { id: 'board-local' } } });
    assert.equal(state.runId, undefined);
    assert.equal(state.uploads, undefined);
    assert.deepEqual(state.tiles, { t: 1 });                                           // the picked pictures stay shared
    assert.equal(siteState(state, 'local'), state.sites.local);
});

test('new runs: one record per site, kept across calls (and an empty legacy state moves nothing)', () => {
    const state = { kind: 'discover', tiles: {}, uploads: {}, boards: {} };
    const local = siteState(state, 'local');
    local.uploads.sha1 = 'img-local';
    assert.equal(siteState(state, 'local').uploads.sha1, 'img-local');
    assert.deepEqual(siteState(state, 'prod').uploads, {});
    assert.deepEqual(Object.keys(state.sites).sort(), ['local', 'prod']);
    assert.equal(state.uploads, undefined);
});
