// tests/unit/contentSources.test.mjs — the content tools' offline pieces:
// license text → our codes + flags, candidate ranking (blocked never taken),
// the spreadsheet reader on the real Content Tracker export, env files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fromCommons, fromOpenverse, licenseCode, rightsOf, stripHtml } from '../../tools/content/lib/license.mjs';
import { rank } from '../../tools/content/lib/sources.mjs';
import { byCategory, readContentTracker } from '../../tools/content/lib/sheet.mjs';
import { parseEnvFile } from '../../tools/content/lib/env.mjs';

test('licenseCode: the ways sources spell licenses → our codes', () => {
    assert.equal(licenseCode('CC BY-SA 4.0'), 'cc-by-sa-4.0');
    assert.equal(licenseCode('cc-by-sa-3.0-de'), 'cc-by-sa-3.0');
    assert.equal(licenseCode('CC BY 2.0'), 'cc-by-2.0');
    assert.equal(licenseCode('CC BY-NC-ND 2.0'), 'cc-by-nc-nd-2.0');
    assert.equal(licenseCode('CC0'), 'cc0');
    assert.equal(licenseCode('Public domain'), 'pdm');
    assert.equal(licenseCode('pd'), 'pdm');
    assert.equal(licenseCode('GFDL'), 'unknown');
    assert.equal(licenseCode(''), 'unknown');
});

test('fromCommons: restrictions become flags; attribution only when required', () => {
    const logo = fromCommons({
        License: { value: 'pd' }, LicenseShortName: { value: 'Public domain' },
        Restrictions: { value: 'trademarked' }, Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:X">X</a>' },
    });
    assert.equal(logo.license, 'pdm');
    assert.deepEqual(logo.flags, ['trademark']);
    assert.equal(logo.attribution, null);
    assert.equal(logo.creatorUrl, 'https://commons.wikimedia.org/wiki/User:X');
    assert.equal(rightsOf(logo).status, 'flagged');

    const person = fromCommons({
        License: { value: 'cc-by-sa-4.0' }, LicenseShortName: { value: 'CC BY-SA 4.0' },
        Restrictions: { value: 'personality' }, AttributionRequired: { value: 'true' }, Artist: { value: 'Jane Doe' },
    });
    assert.deepEqual(rightsOf(person).flags.sort(), ['identifiable_person', 'share_alike']);
    assert.equal(person.attribution, 'Jane Doe · CC BY-SA 4.0 · Wikimedia Commons');
    assert.equal(stripHtml('<b>A&amp;B</b>&nbsp;c'), 'A&B c');
});

test('fromOpenverse: NC/ND results come out blocked; CC0 ok', () => {
    assert.equal(rightsOf(fromOpenverse({ license: 'by-nc', license_version: '2.0' })).status, 'blocked');
    assert.equal(rightsOf(fromOpenverse({ license: 'by-nd', license_version: '4.0' })).status, 'blocked');
    assert.equal(rightsOf(fromOpenverse({ license: 'cc0', license_version: '1.0' })).status, 'ok');
    assert.equal(rightsOf(fromOpenverse({ license: 'by', license_version: '2.0' })).status, 'ok');
});

test('rank: blocked dropped, ok before flagged, bigger first', () => {
    const ranked = rank([
        { title: 'nc', license: 'cc-by-nc-2.0', flags: [], width: 4000, height: 3000 },
        { title: 'sa-big', license: 'cc-by-sa-4.0', flags: [], width: 3000, height: 2000 },
        { title: 'ok-small', license: 'cc0', flags: [], width: 800, height: 600 },
        { title: 'ok-big', license: 'cc-by-4.0', flags: [], width: 2000, height: 1500 },
    ]);
    assert.deepEqual(ranked.map(c => c.title), ['ok-big', 'ok-small', 'sa-big']);
    assert.equal(ranked[2].rights.status, 'flagged');
});

test('readContentTracker: the committed spreadsheet export reads cleanly', () => {
    const { sheetName, items, duplicates } = readContentTracker();
    assert.ok(sheetName);
    assert.ok(items.length > 50, `items: ${items.length}`);
    const ids = new Set();
    for (const it of items) {
        assert.ok(it.itemId && it.category && it.answer, JSON.stringify(it));
        assert.ok(!ids.has(it.itemId), `duplicate id ${it.itemId}`);
        ids.add(it.itemId);
        if (it.url) assert.doesNotThrow(() => new URL(it.url));
        if (it.difficulty !== null) assert.ok([100, 200, 300, 400, 500].includes(it.difficulty));
    }
    assert.ok(items.some(it => it.url?.includes('unsplash.com/photos/')), 'hyperlinks are read');
    assert.ok(Array.isArray(duplicates));
    const groups = byCategory(items);
    assert.equal([...groups.values()].flat().length, items.length);
});

test('parseEnvFile: KEY=VALUE, comments, quotes, CRLF', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pt-env-'));
    const file = path.join(dir, '.env');
    writeFileSync(file, '# comment\r\nA=1\r\nB = "two words"\r\n  C=\'x\'\r\nnot a line\r\n');
    assert.deepEqual(parseEnvFile(file), { A: '1', B: 'two words', C: 'x' });
    assert.deepEqual(parseEnvFile(path.join(dir, 'missing')), {});
});
