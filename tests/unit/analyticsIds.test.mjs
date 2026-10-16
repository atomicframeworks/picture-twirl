// tests/unit/analyticsIds.test.mjs
// Verifies that generateId() produces valid, unique, cryptographically random
// analytics correlation identifiers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateId } from '../../src/game/analyticsIds.js';

test('generateId returns a non-empty string', () => {
    const id = generateId();
    assert.equal(typeof id, 'string');
    assert.ok(id.length > 0, 'id should not be empty');
});

test('generateId output matches UUID or 32-char hex format', () => {
    const id = generateId();
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const isHex32 = /^[0-9a-f]{32}$/.test(id);
    assert.ok(isUUID || isHex32, `id "${id}" should be a UUID or 32-char hex string`);
});

test('generateId produces distinct values on consecutive calls', () => {
    const ids = Array.from({ length: 10 }, generateId);
    const unique = new Set(ids);
    assert.equal(unique.size, 10, 'all 10 consecutive calls should return distinct values');
});

test('analyticsId and roundId generated for the same game are distinct', () => {
    const analyticsId = generateId();
    const roundId = generateId();
    assert.notEqual(analyticsId, roundId, 'analyticsId and roundId should be different values');
});

test('generateId does not use Math.random or timestamps', () => {
    // Freeze Math.random and Date.now; generateId must not call them.
    const origRandom = Math.random;
    const origNow = Date.now;
    let mathRandomCalled = false;
    let dateNowCalled = false;
    Math.random = () => { mathRandomCalled = true; return 0; };
    Date.now = () => { dateNowCalled = true; return 0; };
    try {
        generateId();
    } finally {
        Math.random = origRandom;
        Date.now = origNow;
    }
    assert.ok(!mathRandomCalled, 'generateId must not call Math.random()');
    assert.ok(!dateNowCalled, 'generateId must not call Date.now()');
});
