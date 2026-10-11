// tests/unit/migrateCode.test.mjs — scripts/migrate-code.mjs (`npm run
// migrate:code`): code written against Firebase is rewritten to the realtime
// layer by module specifier only; what it can't convert is reported, never
// silently dropped. This is what an in-flight branch goes through (MIGRATION.md §5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rewriteImports } from '../../scripts/migrate-code.mjs';

const SRC = '/repo/src';
const at = (rel) => path.join(SRC, rel);

test('named imports from firebase/database and ../firebase.js → src/realtime (relative paths per file)', () => {
    const before = `import { rtdb, getCurrentUser } from '../firebase.js';
import { ref, onValue, update, onDisconnect as od } from 'firebase/database';
import * as P from '../data/paths.js';`;
    const { text, changed, problems } = rewriteImports(before, at('game/newThing.js'), SRC);
    assert.equal(changed, true);
    assert.deepEqual(problems, []);
    assert.match(text, /from '\.\.\/realtime\/client\.js';/);
    assert.match(text, /\{ ref, onValue, update, onDisconnect as od \} from '\.\.\/realtime\/db\.js';/);
    assert.match(text, /from '\.\.\/data\/paths\.js';/);                    // untouched
    const deeper = rewriteImports(`import { ref } from 'firebase/database';`, at('game/sub/x.js'), SRC).text;
    assert.match(deeper, /'\.\.\/\.\.\/realtime\/db\.js'/);
    const top = rewriteImports(`import { rtdb } from './firebase.js';`, at('main.js'), SRC).text;
    assert.match(top, /'\.\/realtime\/client\.js'/);
});

test('multi-line, namespace, re-export and dynamic imports', () => {
    const before = `import {
    ref,
    get,
} from 'firebase/database';
import * as db from "firebase/database";
export { serverTimestamp } from 'firebase/database';
const mod = await import('../firebase.js');`;
    const { text, problems } = rewriteImports(before, at('game/x.js'), SRC);
    assert.deepEqual(problems, []);
    assert.equal((text.match(/realtime\/db\.js/g) || []).length, 3);
    assert.match(text, /import \* as db from "\.\.\/realtime\/db\.js";/);
    assert.match(text, /import\('\.\.\/realtime\/client\.js'\)/);
});

test('idempotent: already-migrated code is left alone', () => {
    const migrated = `import { ref } from '../realtime/db.js';\nimport { rtdb } from '../realtime/client.js';`;
    const res = rewriteImports(migrated, at('game/x.js'), SRC);
    assert.equal(res.changed, false);
    assert.equal(res.text, migrated);
});

test('what it cannot convert is reported, not hidden', () => {
    const { problems } = rewriteImports(`import { ref, runTransaction, onChildAdded } from 'firebase/database';
import { getAuth } from 'firebase/auth';
import { secretHelper } from '../firebase.js';`, at('game/x.js'), SRC);
    assert.ok(problems.some(p => p.includes('runTransaction, onChildAdded')), problems.join('\n'));
    assert.ok(problems.some(p => p.includes('firebase/auth')));
    assert.ok(problems.some(p => p.includes('secretHelper')));
});

test('other modules named firebase.js (not src/firebase.js) are not touched', () => {
    const text = `import { x } from './vendor/firebase.js';`;
    assert.equal(rewriteImports(text, at('game/x.js'), SRC).changed, false);
});
