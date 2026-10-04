// tests/unit/tree.test.mjs — src/shared/tree.js: the JSON-tree model live games
// use on both sides (GameRoom + the browser's mirror) — Firebase's semantics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyOps, deepEqual, getAt, isPrefix, isValidKey, normalize, overlaps, resolveSentinels, setAt, splitPath,
} from '../../src/shared/tree.js';

test('paths: split, prefixes, overlap, valid keys', () => {
    assert.deepEqual(splitPath('/a//b/c/'), ['a', 'b', 'c']);
    assert.deepEqual(splitPath(''), []);
    assert.ok(isPrefix(['a'], ['a', 'b']));
    assert.ok(!isPrefix(['a', 'b'], ['a']));
    assert.ok(overlaps(['a', 'b'], ['a']) && overlaps([], ['x']) && !overlaps(['a'], ['b']));
    assert.ok(isValidKey('p_abc-123'));
    for (const bad of ['', 'a.b', 'a$', 'a#', 'a[0]', 'a/b']) assert.ok(!isValidKey(bad), bad);
});

test('setAt: replaces, deletes with null, prunes empty parents, never mutates', () => {
    const t0 = { a: { b: 1, c: 2 }, d: 3 };
    const t1 = setAt(t0, 'a/b', 9);
    assert.deepEqual(t1, { a: { b: 9, c: 2 }, d: 3 });
    assert.deepEqual(t0, { a: { b: 1, c: 2 }, d: 3 });                 // untouched
    assert.equal(t1.d, t0.d);
    assert.deepEqual(setAt({ a: { b: 1 } }, 'a/b', null), null);       // empty parents disappear
    assert.deepEqual(setAt(null, 'x/y', { z: 1 }), { x: { y: { z: 1 } } });
    assert.deepEqual(setAt({ a: 1 }, '', { b: 2 }), { b: 2 });           // root replace
    assert.equal(getAt({ a: { b: 0 } }, 'a/b'), 0);
    assert.equal(getAt({ a: 1 }, 'a/b/c'), null);
});

test('normalize: no nulls, no empty objects', () => {
    assert.deepEqual(normalize({ a: null, b: {}, c: { d: undefined }, e: 0, f: '', g: [1, null] }), { e: 0, f: '', g: [1, null] });
    assert.equal(normalize({}), null);
});

test('sentinels: timestamps from the room clock, increments from the current value', () => {
    let t = 1000;
    const now = () => ++t;
    const { tree } = applyOps({ score: 5 }, [
        { p: 'score', v: { '.sv': { increment: 100 } } },
        { p: 'missing', v: { '.sv': { increment: 3 } } },
        { p: 'row', v: { joinedAt: { '.sv': 'timestamp' }, nested: { at: { '.sv': 'timestamp' } } } },
    ], { now });
    assert.equal(tree.score, 105);
    assert.equal(tree.missing, 3);
    assert.equal(tree.row.joinedAt, 1001);
    assert.equal(tree.row.nested.at, 1002);
    assert.equal(resolveSentinels({ a: [{ '.sv': 'timestamp' }] }, { now: () => 7, current: () => null }).a[0], 7);
});

test('applyOps: update semantics (each op replaces its own path) and changed paths', () => {
    const { tree, changed } = applyOps({ p: { x: { name: 'A', team: 'none' } } }, [
        { p: 'p/x/team', v: 'A' },
        { p: 'p/y', v: { name: 'B' } },
    ]);
    assert.deepEqual(tree, { p: { x: { name: 'A', team: 'A' }, y: { name: 'B' } } });
    assert.deepEqual(changed, [['p', 'x', 'team'], ['p', 'y']]);
});

test('deepEqual', () => {
    assert.ok(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
    assert.ok(!deepEqual({ a: 1 }, { a: 1, b: 2 }));
    assert.ok(!deepEqual([1], { 0: 1 }));
});
