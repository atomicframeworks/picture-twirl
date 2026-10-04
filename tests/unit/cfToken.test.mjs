// tests/unit/cfToken.test.mjs — scripts/lib/cfToken.mjs: which string in
// cloudflare-token.txt is the API token `npm run cf` uses. People save that file
// from a phone, so it may hold just the token or everything Cloudflare showed.
// Fake values are built at runtime so no token-shaped literal is ever committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenFromText } from '../../scripts/lib/cfToken.mjs';

const fake = (prefix, n = 40) => prefix + 'Ab3_-'.repeat(Math.ceil(n / 5)).slice(0, n);
const ACCOUNT_TOKEN = fake('cf' + 'at_');
const USER_TOKEN = fake('cf' + 'ut_');
const PLAIN_TOKEN = fake('', 40);
const hex = (n) => 'a1b2c3d4e5f6'.repeat(Math.ceil(n / 12)).slice(0, n);

test('just the token (prefixed or plain), with stray whitespace', () => {
    assert.equal(tokenFromText(`${ACCOUNT_TOKEN}\n`), ACCOUNT_TOKEN);
    assert.equal(tokenFromText(`  ${USER_TOKEN}  `), USER_TOKEN);
    assert.equal(tokenFromText(`${PLAIN_TOKEN}\r\n`), PLAIN_TOKEN);
});

test('everything Cloudflare showed (token, R2 keys, endpoint) → the prefixed API token', () => {
    const pasted = `API key\n${ACCOUNT_TOKEN}\nAccess key id\n${hex(32)}\nAccess key secret\n${hex(64)}\nEndpoint\nhttps://${hex(32)}.r2.cloudflarestorage.com`;
    assert.equal(tokenFromText(pasted), ACCOUNT_TOKEN);
    assert.equal(tokenFromText(`Token: ${ACCOUNT_TOKEN}`), ACCOUNT_TOKEN);
});

test('no single token → null (the scripts then explain what the file should hold)', () => {
    assert.equal(tokenFromText(''), null);
    assert.equal(tokenFromText('paste the token here'), null);
    assert.equal(tokenFromText(`Token: ${PLAIN_TOKEN}`), null);         // unprefixed + other words: can't tell
    assert.equal(tokenFromText(`${ACCOUNT_TOKEN}\n${USER_TOKEN}`), null); // two tokens: which one?
    assert.equal(tokenFromText(`${ACCOUNT_TOKEN}\n${ACCOUNT_TOKEN}`), ACCOUNT_TOKEN); // the same one twice is fine
});
