// tests/unit/rights.test.mjs — src/shared/rights.js (what a license means for us)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { licenseInfo, assessRights, creditFor, RIGHTS_FLAGS } from '../../src/shared/rights.js';

test('free licenses are ok; CC BY needs a credit', () => {
    for (const code of ['cc0', 'pdm', 'us-gov', 'unsplash', 'pexels', 'pixabay', 'permission']) {
        assert.equal(licenseInfo(code).status, 'ok', code);
        assert.equal(licenseInfo(code).attribution, false, code);
    }
    assert.equal(licenseInfo('cc-by-4.0').status, 'ok');
    assert.equal(licenseInfo('cc-by-4.0').attribution, true);
});

test('share-alike is allowed but flagged', () => {
    assert.deepEqual(assessRights({ license: 'cc-by-sa-4.0' }), { status: 'flagged', flags: ['share_alike'] });
});

test('NonCommercial and NoDerivatives variants are blocked (ads + the swirl)', () => {
    for (const code of ['cc-by-nc', 'cc-by-nc-4.0', 'cc-by-nc-sa-3.0', 'cc-by-nc-nd-4.0', 'CC-BY-NC-2.0']) {
        assert.equal(licenseInfo(code).status, 'blocked', code);
    }
    for (const code of ['cc-by-nd', 'cc-by-nd-4.0']) {
        assert.equal(licenseInfo(code).status, 'blocked', code);
    }
});

test('unknown or unrecognized licenses are flagged "rights unknown"', () => {
    assert.deepEqual(assessRights({}), { status: 'flagged', flags: ['rights_unknown'] });
    assert.deepEqual(assessRights({ license: 'made-up' }), { status: 'flagged', flags: ['rights_unknown'] });
});

test('extra flags turn an ok license into flagged; unknown flag codes are dropped', () => {
    assert.deepEqual(
        assessRights({ license: 'cc0', flags: ['trademark', 'not_a_flag', 'trademark'] }),
        { status: 'flagged', flags: ['trademark'] },
    );
    // A blocked license stays blocked whatever the flags.
    assert.equal(assessRights({ license: 'cc-by-nd-4.0', flags: ['trademark'] }).status, 'blocked');
});

test('every flag has a label and a plain-language reason', () => {
    for (const [code, f] of Object.entries(RIGHTS_FLAGS)) {
        assert.ok(f.label && f.reason, code);
    }
});

test('creditFor: only when the license requires it; stored attribution wins', () => {
    assert.equal(creditFor({ license: 'cc0', creator: 'X' }), null);
    assert.equal(creditFor({ license: 'unsplash', creator: 'X' }), null);
    assert.equal(creditFor({ license: 'cc-by-sa-4.0', creator: 'Jane' }), 'Jane · CC BY-SA 4.0');
    assert.equal(creditFor({ license: 'cc-by-2.0', attribution: '“Cat” by Jane, CC BY 2.0' }), '“Cat” by Jane, CC BY 2.0');
    assert.equal(creditFor({ license: 'cc-by-4.0' }), 'CC BY 4.0');
    assert.equal(creditFor(null), null);
});
