// tests/unit/validation.test.mjs — normalizeDraft + the publish gate
// (src/shared/boards.js validateForPublish).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDraft, validateForPublish, emptyDraft, LIMITS } from '../../src/shared/boards.js';

const id = (n) => `img_${String(n).padStart(16, '0')}`;

function readyDraft() {
    const d = emptyDraft();
    d.categories.forEach((cat, c) => {
        cat.title = `Cat ${c}`;
        cat.tiles.forEach((t, r) => { t.answer = `Answer ${c}${r}`; t.imageId = id(c * 5 + r); });
    });
    return d;
}

function images(status = 'ok', size = 800) {
    const m = new Map();
    for (let i = 0; i < 25; i++) m.set(id(i), { rights_status: status, rights_flags: status === 'flagged' ? '["trademark"]' : '[]', width: size, height: size });
    return m;
}

test('normalizeDraft always returns an exact 5×5 with capped strings', () => {
    const d = normalizeDraft({ categories: [{ title: 'x'.repeat(100), tiles: [{ answer: 'a'.repeat(200), imageId: 'img_abc', notes: 42 }] }] });
    assert.equal(d.categories.length, 5);
    assert.ok(d.categories.every(c => c.tiles.length === 5));
    assert.equal(d.categories[0].title.length, LIMITS.CATEGORY_TITLE);
    assert.equal(d.categories[0].tiles[0].answer.length, LIMITS.ANSWER);
    assert.equal(d.categories[0].tiles[0].imageId, null);            // malformed id dropped
    assert.equal(d.categories[0].tiles[0].notes, '42');
    assert.deepEqual(d.points, [100, 200, 300, 400, 500]);
    assert.deepEqual(normalizeDraft(null), emptyDraft());
    assert.deepEqual(normalizeDraft({ points: [1, 2, 3] }).points, [100, 200, 300, 400, 500]);
    assert.deepEqual(normalizeDraft({ points: [10, 20, 30, 40, 50] }).points, [10, 20, 30, 40, 50]);
});

test('normalizeDraft keeps trailing spaces (people are mid-typing during autosave)', () => {
    const d = emptyDraft();
    d.categories[0].title = 'Pop ';
    assert.equal(normalizeDraft(d).categories[0].title, 'Pop ');
});

test('a complete board passes with no problems', () => {
    const r = validateForPublish({ title: 'Ready', emoji: '✅', draft: readyDraft(), imagesById: images() });
    assert.equal(r.ok, true);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.warnings, []);
});

test('an empty board lists every missing piece', () => {
    const r = validateForPublish({ title: '  ', emoji: '', draft: emptyDraft(), imagesById: new Map() });
    assert.equal(r.ok, false);
    const codes = r.problems.map(p => p.code);
    assert.equal(codes.filter(c => c === 'title_missing').length, 1);
    assert.equal(codes.filter(c => c === 'emoji_missing').length, 1);
    assert.equal(codes.filter(c => c === 'category_title_missing').length, 5);
    assert.equal(codes.filter(c => c === 'picture_missing').length, 25);
    assert.equal(codes.filter(c => c === 'answer_missing').length, 25);
});

test('messages point at the tile ("Category · points")', () => {
    const d = readyDraft();
    d.categories[2].tiles[3].answer = ' ';
    const r = validateForPublish({ title: 'T', emoji: 'E', draft: d, imagesById: images() });
    assert.deepEqual(r.problems, [{ code: 'answer_missing', message: 'Cat 2 · 400: add the answer.', cat: 2, row: 3 }]);
});

test('blocked pictures block; flagged + small pictures + duplicate answers only warn', () => {
    const blocked = validateForPublish({ title: 'T', emoji: 'E', draft: readyDraft(), imagesById: images('blocked') });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.problems.filter(p => p.code === 'picture_blocked').length, 25);

    const d = readyDraft();
    d.categories[4].tiles[4].answer = 'answer 00';                  // same as Cat 0 · 100 (case-insensitive)
    const r = validateForPublish({ title: 'T', emoji: 'E', draft: d, imagesById: images('flagged', 300) });
    assert.equal(r.ok, true);
    assert.equal(r.warnings.filter(w => w.code === 'picture_flagged').length, 25);
    assert.match(r.warnings.find(w => w.code === 'picture_flagged').message, /Logo \/ trademark/);
    assert.equal(r.warnings.filter(w => w.code === 'picture_small').length, 25);
    assert.deepEqual(r.warnings.filter(w => w.code === 'answer_duplicate').map(w => [w.cat, w.row]), [[4, 4]]);
});

test('a picture id with no stored picture is a problem', () => {
    const r = validateForPublish({ title: 'T', emoji: 'E', draft: readyDraft(), imagesById: new Map() });
    assert.equal(r.problems.filter(p => p.code === 'picture_unknown').length, 25);
});
