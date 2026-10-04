// tests/unit/localSecrets.test.mjs — scripts/lib/localSecrets.mjs: every machine's
// .dev.vars gets its own random SESSION_SECRET / IMPORT_TOKEN instead of the
// public example values (the repo is public; `npm run share` exposes the dev server).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withOwnSecrets, envValues } from '../../scripts/lib/localSecrets.mjs';

const example = '# comment\nADMIN_PASSWORD=dev-admin-password\nSESSION_SECRET=dev-session-secret-change-me\nIMPORT_TOKEN=dev-import-token\n';
const counter = () => { let n = 0; return () => `random-${++n}`; };

test('a fresh copy of the example: both public secrets become random, the admin password stays', () => {
    const { text, changed } = withOwnSecrets(example, example, counter());
    assert.deepEqual(changed, ['SESSION_SECRET', 'IMPORT_TOKEN']);
    assert.deepEqual(envValues(text), { ADMIN_PASSWORD: 'dev-admin-password', SESSION_SECRET: 'random-1', IMPORT_TOKEN: 'random-2' });
    assert.match(text, /^# comment$/m);
});

test('values someone set themselves are never touched; empty ones are filled', () => {
    const mine = 'ADMIN_PASSWORD=team-password-example\nSESSION_SECRET=my-own-long-value\nIMPORT_TOKEN=\n';
    const { text, changed } = withOwnSecrets(mine, example, counter());
    assert.deepEqual(changed, ['IMPORT_TOKEN']);
    assert.deepEqual(envValues(text), { ADMIN_PASSWORD: 'team-password-example', SESSION_SECRET: 'my-own-long-value', IMPORT_TOKEN: 'random-1' });
});

test('already done → nothing changes (safe to run before every command)', () => {
    const once = withOwnSecrets(example, example, counter()).text;
    assert.deepEqual(withOwnSecrets(once, example, counter()), { text: once, changed: [] });
});
