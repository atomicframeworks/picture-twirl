// tests/unit/boards.test.mjs — src/shared/boards.js (board shape + snapshot)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CATEGORY_COUNT, TILES_PER_CATEGORY, DEFAULT_POINTS,
    titleKey, slugify, emptyDraft, isTileReady, imageIdsOf, boardStats, buildSnapshot, mediaUrl,
} from '../../src/shared/boards.js';

test('titleKey normalizes case, spacing and unicode forms', () => {
    assert.equal(titleKey('  Pop   Culture ICONS '), 'pop culture icons');
    assert.equal(titleKey('Beyoncé'), titleKey('Beyoncé')); // combining accent == precomposed
    assert.equal(titleKey(null), '');
});

test('slugify makes URL-safe slugs and never returns empty', () => {
    assert.equal(slugify('Pop Culture Icons!'), 'pop-culture-icons');
    assert.equal(slugify('Beyoncé & Friends'), 'beyonce-friends');
    assert.equal(slugify('🎃🎃🎃'), 'board');
    assert.ok(slugify('x'.repeat(200)).length <= 48);
    assert.ok(!slugify('a'.repeat(47) + ' b').endsWith('-'));
});

test('emptyDraft is a blank 5×5 with the default points', () => {
    const d = emptyDraft();
    assert.equal(d.categories.length, CATEGORY_COUNT);
    for (const c of d.categories) {
        assert.equal(c.title, '');
        assert.equal(c.tiles.length, TILES_PER_CATEGORY);
        for (const t of c.tiles) assert.deepEqual(t, { answer: '', imageId: null, notes: '' });
    }
    assert.deepEqual(d.points, DEFAULT_POINTS);
    d.points[0] = 999; // returns a copy, not the shared constant
    assert.equal(DEFAULT_POINTS[0], 100);
});

test('a tile is ready only with a picture AND a non-blank answer', () => {
    assert.equal(isTileReady({ imageId: 'img_1', answer: 'Cat' }), true);
    assert.equal(isTileReady({ imageId: 'img_1', answer: '   ' }), false);
    assert.equal(isTileReady({ imageId: null, answer: 'Cat' }), false);
    assert.equal(isTileReady(undefined), false);
});

function sampleDraft() {
    const d = emptyDraft();
    d.categories[0].title = 'Animals';
    d.categories[0].tiles[0] = { answer: 'Cat', imageId: 'img_a', notes: '' };
    d.categories[0].tiles[1] = { answer: 'Dog', imageId: 'img_b', notes: '' };
    d.categories[1].tiles[0] = { answer: '', imageId: 'img_a', notes: '' }; // reused picture, no answer
    return d;
}

test('imageIdsOf lists each picture once', () => {
    assert.deepEqual(imageIdsOf(sampleDraft()).sort(), ['img_a', 'img_b']);
    assert.deepEqual(imageIdsOf(emptyDraft()), []);
});

test('boardStats counts ready tiles and tiles with flagged pictures', () => {
    const images = new Map([
        ['img_a', { rights_status: 'flagged' }],
        ['img_b', { rights_status: 'ok' }],
    ]);
    assert.deepEqual(boardStats(sampleDraft(), images), { tilesReady: 2, flaggedTiles: 2 });
});

test('buildSnapshot resolves pictures to /media URLs and adds credits', () => {
    const images = new Map([
        ['img_a', { display_key: 'display/aa.webp', thumb_key: 'thumb/aa.webp', width: 800, height: 600, license: 'cc0' }],
        ['img_b', { display_key: 'display/bb.webp', thumb_key: 'thumb/bb.webp', width: 640, height: 640, license: 'cc-by-4.0', creator: 'Jane Doe' }],
    ]);
    const board = { id: 'brd_1', slug: 'animals', title: 'Animals', emoji: '🐾', description: null };
    const snap = buildSnapshot({ board, draft: sampleDraft(), rev: 7, imagesById: images });

    assert.equal(snap.rev, 7);
    assert.equal(snap.description, '');
    assert.equal(snap.categories.length, 5);
    const [cat] = snap.categories;
    assert.equal(cat.title, 'Animals');
    assert.deepEqual(cat.tiles[0].image, { url: '/media/display/aa.webp', thumb: '/media/thumb/aa.webp', width: 800, height: 600 });
    assert.equal(cat.tiles[0].credit, null);              // CC0: no credit needed
    assert.equal(cat.tiles[1].credit, 'Jane Doe · CC BY 4.0');
    assert.equal(snap.categories[2].tiles[0].image, null); // empty tile
});

test('mediaUrl', () => {
    assert.equal(mediaUrl('display/x.webp'), '/media/display/x.webp');
    assert.equal(mediaUrl(null), '');
});
