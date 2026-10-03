#!/usr/bin/env node
// scripts/migrate-code.mjs — `npm run migrate:code` (PROPOSAL.md §9.3)
//
// Moves game code from Firebase to the realtime layer that replaced it. Only
// IMPORT LINES change — src/realtime/ keeps Firebase's function names:
//
//   import { ref, onValue, … } from 'firebase/database'  →  from '<rel>/realtime/db.js'
//   import { rtdb, getCurrentUser, … } from '<rel>/firebase.js'  →  from '<rel>/realtime/client.js'
//
// Run it after merging work written against Firebase (e.g. from `main`), then
// `npm test`. `--check` changes nothing and exits 1 if any Firebase import is
// left (CI / lint guard). Anything it can't rewrite (firebase/app, firebase/auth,
// a Firebase function the shim doesn't have) is listed for a human.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DB_MODULE = path.join(SRC, 'realtime', 'db.js');
const CLIENT_MODULE = path.join(SRC, 'realtime', 'client.js');
const OLD_FIREBASE = path.join(SRC, 'firebase.js');

/** What src/realtime/db.js provides (Firebase's names). */
const DB_EXPORTS = new Set(['ref', 'child', 'onValue', 'get', 'set', 'update', 'remove', 'push', 'serverTimestamp', 'increment', 'onDisconnect']);
/** What src/realtime/client.js provides in place of src/firebase.js. */
const CLIENT_EXPORTS = new Set(['rtdb', 'getCurrentUser', 'requireAuth', 'waitForAuthReady', 'initializeFirebase', 'initializeRealtime', 'gameExists', 'getRoomInfo', 'reserveGameCode']);

const checkOnly = process.argv.includes('--check');

function* jsFiles(dir) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === 'realtime' || name === 'node_modules') continue;
            yield* jsFiles(full);
        } else if (/\.(m?js)$/.test(name) && full !== OLD_FIREBASE) {
            yield full;
        }
    }
}

const relImport = (fromFile, target) => {
    let rel = path.relative(path.dirname(fromFile), target).split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return rel;
};

const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2\s*;?/g;
const names = (list) => list.split(',').map(s => s.trim()).filter(Boolean).map(s => s.split(/\s+as\s+/)[0].trim());

const changed = [];
const problems = [];

for (const file of jsFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    let next = text.replace(IMPORT_RE, (whole, list, quote, spec) => {
        if (spec === 'firebase/database') {
            const missing = names(list).filter(n => !DB_EXPORTS.has(n));
            if (missing.length) problems.push(`${rel}: firebase/database → ${missing.join(', ')} not provided by src/realtime/db.js`);
            return `import {${list}} from ${quote}${relImport(file, DB_MODULE)}${quote};`;
        }
        if (spec.endsWith('firebase.js') && path.resolve(path.dirname(file), spec) === OLD_FIREBASE) {
            const missing = names(list).filter(n => !CLIENT_EXPORTS.has(n));
            if (missing.length) problems.push(`${rel}: firebase.js → ${missing.join(', ')} not provided by src/realtime/client.js`);
            return `import {${list}} from ${quote}${relImport(file, CLIENT_MODULE)}${quote};`;
        }
        return whole;
    });
    if (/from\s*['"]firebase\/(app|auth|firestore|storage)['"]/.test(next)) problems.push(`${rel}: imports a Firebase SDK module the game no longer uses`);
    if (next !== text) {
        changed.push(rel);
        if (!checkOnly) writeFileSync(file, next);
    }
}

if (checkOnly) {
    if (changed.length || problems.length) {
        console.error('Firebase imports left (run `npm run migrate:code`):');
        for (const f of changed) console.error(`  ${f}`);
        for (const p of problems) console.error(`  ${p}`);
        process.exit(1);
    }
    console.log('No Firebase imports — all game code uses src/realtime/.');
} else {
    console.log(changed.length ? `Rewrote imports in ${changed.length} file(s):\n${changed.map(f => `  ${f}`).join('\n')}` : 'Nothing to rewrite.');
    if (problems.length) {
        console.error(`\nNeeds a human:\n${problems.map(p => `  ${p}`).join('\n')}`);
        process.exitCode = 1;
    }
}
