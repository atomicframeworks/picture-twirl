// tests/unit/cloudflare.test.mjs — scripts/lib/cloudflare.mjs: which string in
// cloudflare-token.txt is the API token `npm run cf` uses (people save that file
// from a phone: just the token, or everything Cloudflare showed), and which
// secrets `npm run cf:secrets` sends to the production Worker.
// Fake values are built at runtime so no token-shaped literal is ever committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSecrets, tokenFromText } from '../../scripts/lib/cloudflare.mjs';

const fake = (prefix, n = 40) => prefix + 'Ab3_-'.repeat(Math.ceil(n / 5)).slice(0, n);
const ACCOUNT_TOKEN = fake('cf' + 'at_');
const USER_TOKEN = fake('cf' + 'ut_');
const PLAIN_TOKEN = fake('', 40);
const hex = (n) => 'a1b2c3d4e5f6'.repeat(Math.ceil(n / 12)).slice(0, n);

test('token file: just the token (prefixed or plain), with stray whitespace', () => {
    assert.equal(tokenFromText(`${ACCOUNT_TOKEN}\n`), ACCOUNT_TOKEN);
    assert.equal(tokenFromText(`  ${USER_TOKEN}  `), USER_TOKEN);
    assert.equal(tokenFromText(`${PLAIN_TOKEN}\r\n`), PLAIN_TOKEN);
});

test('token file: everything Cloudflare showed (token, R2 keys, endpoint) → the prefixed API token', () => {
    const pasted = `API key\n${ACCOUNT_TOKEN}\nAccess key id\n${hex(32)}\nAccess key secret\n${hex(64)}\nEndpoint\nhttps://${hex(32)}.r2.cloudflarestorage.com`;
    assert.equal(tokenFromText(pasted), ACCOUNT_TOKEN);
    assert.equal(tokenFromText(`Token: ${ACCOUNT_TOKEN}`), ACCOUNT_TOKEN);
});

test('token file: no single token → null (the scripts then explain what the file should hold)', () => {
    assert.equal(tokenFromText(''), null);
    assert.equal(tokenFromText('paste the token here'), null);
    assert.equal(tokenFromText(`Token: ${PLAIN_TOKEN}`), null);         // unprefixed + other words: can't tell
    assert.equal(tokenFromText(`${ACCOUNT_TOKEN}\n${USER_TOKEN}`), null); // two tokens: which one?
    assert.equal(tokenFromText(`${ACCOUNT_TOKEN}\n${ACCOUNT_TOKEN}`), ACCOUNT_TOKEN); // the same one twice is fine
});

// planSecrets — fake values, a counter instead of real randomness.
const counter = () => { let n = 0; return () => `random-${++n}`; };
const devVars = { ADMIN_PASSWORD: 'team-password-example', SESSION_SECRET: 'dev-only', IMPORT_TOKEN: 'dev-only' };
const exampleVars = { ADMIN_PASSWORD: 'placeholder-example', SESSION_SECRET: 'x', IMPORT_TOKEN: 'y' };

test('secrets, first time: the team password, a new import key (to save) and a new session secret', () => {
    const plan = planSecrets({ devVars, exampleVars, existing: new Set(), random: counter() });
    assert.equal(plan.problem, null);
    assert.deepEqual(plan.secrets, { ADMIN_PASSWORD: 'team-password-example', IMPORT_TOKEN: 'random-1', SESSION_SECRET: 'random-2' });
    assert.equal(plan.saveImportToken, 'random-1');
});

test('secrets, again (e.g. a new team password): same import key, the session secret is left alone', () => {
    const plan = planSecrets({ devVars, exampleVars, savedImportToken: 'saved-key',
        existing: new Set(['ADMIN_PASSWORD', 'IMPORT_TOKEN', 'SESSION_SECRET']), random: counter() });
    assert.deepEqual(plan.secrets, { ADMIN_PASSWORD: 'team-password-example', IMPORT_TOKEN: 'saved-key' });
    assert.equal(plan.saveImportToken, null);
    // …unless a new one is asked for (it signs everyone out)
    const fresh = planSecrets({ devVars, exampleVars, savedImportToken: 'saved-key',
        existing: new Set(['SESSION_SECRET']), newSessionSecret: true, random: counter() });
    assert.equal(fresh.secrets.SESSION_SECRET, 'random-1');
});

test('secrets: never the placeholder password, never an empty one; dev-only values never go to production', () => {
    for (const vars of [{ ...devVars, ADMIN_PASSWORD: 'placeholder-example' }, { ...devVars, ADMIN_PASSWORD: '' }, {}]) {
        const plan = planSecrets({ devVars: vars, exampleVars, existing: new Set(), random: counter() });
        assert.match(plan.problem, /admin password/);
        assert.deepEqual(plan.secrets, {});
    }
    const plan = planSecrets({ devVars, exampleVars, existing: new Set(), random: counter() });
    assert.ok(!Object.values(plan.secrets).includes('dev-only'));
});
