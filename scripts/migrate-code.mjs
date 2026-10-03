#!/usr/bin/env node
// scripts/migrate-code.mjs — `npm run migrate:code` (MIGRATION.md §5, PROPOSAL.md §9.3)
//
// Moves game code from Firebase to the realtime layer that replaced it. Only
// MODULE SPECIFIERS change — src/realtime/ keeps Firebase's function names:
//
//   … from 'firebase/database'          →  … from '<rel>/realtime/db.js'
//   … from '<rel>/firebase.js'          →  … from '<rel>/realtime/client.js'
//   (named imports, `import * as X`, `export … from`, and import('…') alike)
//
// Run it after merging work written against Firebase (e.g. an older branch),
// then `npm run lint` and `npm test`. Idempotent — run it any time.
// `--check` changes nothing and exits 1 if any Firebase import is left.
// Anything it can't convert (firebase/app, firebase/auth, a Firebase function
// the realtime layer doesn't have) is listed under "Needs a human".

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

/** What src/realtime/db.js provides (Firebase's names). */
export const DB_EXPORTS = new Set(['ref', 'child', 'onValue', 'get', 'set', 'update', 'remove', 'push', 'serverTimestamp', 'increment', 'onDisconnect']);
/** What src/realtime/client.js provides in place of src/firebase.js. */
export const CLIENT_EXPORTS = new Set(['rtdb', 'getCurrentUser', 'requireAuth', 'waitForAuthReady', 'initializeFirebase', 'initializeRealtime',
    'gameExists', 'getRoomInfo', 'reserveGameCode', 'realtimeStats', 'simulateDrop']);

const relImport = (fromFile, target) => {
    let rel = path.relative(path.dirname(fromFile), target).split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return rel;
};

const importedNames = (list) => list.split(',').map(s => s.trim()).filter(Boolean)
    .map(s => s.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim());

/**
 * Rewrite one file's Firebase imports.
 * @param {string} text      file contents
 * @param {string} file      absolute path of the file
 * @param {string} srcRoot   absolute path of src/ (where realtime/ and the old firebase.js live)
 * @returns {{ text: string, changed: boolean, problems: string[] }}
 */
export function rewriteImports(text, file, srcRoot = SRC) {
    const dbModule = path.join(srcRoot, 'realtime', 'db.js');
    const clientModule = path.join(srcRoot, 'realtime', 'client.js');
    const oldFirebase = path.join(srcRoot, 'firebase.js');
    const problems = [];

    /** New specifier for a module specifier, or null if it isn't a Firebase one. */
    const target = (spec) => {
        if (spec === 'firebase/database') return { to: relImport(file, dbModule), names: DB_EXPORTS, what: 'firebase/database', provider: 'src/realtime/db.js' };
        if (/(^|\/)firebase\.js$/.test(spec) && spec.startsWith('.') && path.resolve(path.dirname(file), spec) === oldFirebase) {
            return { to: relImport(file, clientModule), names: CLIENT_EXPORTS, what: 'firebase.js', provider: 'src/realtime/client.js' };
        }
        return null;
    };

    // Static imports and re-exports: `import … from 'x'`, `export … from 'x'`.
    let next = text.replace(/\b(import|export)(\s+(?:type\s+)?)([\s\S]*?)(\s+from\s*)(['"])([^'"\n]+)\5/g,
        (whole, kw, sp1, clause, sp2, q, spec) => {
            if (/[;]/.test(clause) || clause.length > 2000) return whole;         // not one statement
            const t = target(spec);
            if (!t) return whole;
            const named = clause.match(/\{([^}]*)\}/);
            if (named) {
                const missing = importedNames(named[1]).filter(n => !t.names.has(n));
                if (missing.length) problems.push(`${t.what} → ${missing.join(', ')} isn't provided by ${t.provider}`);
            }
            if (/^\s*[A-Za-z_$][\w$]*\s*(,|$)/.test(clause) && !/^\s*\*/.test(clause) && kw === 'import') {
                problems.push(`${t.what} has no default export — use named imports`);
            }
            return `${kw}${sp1}${clause}${sp2}${q}${t.to}${q}`;
        });
    // Dynamic imports: import('x').
    next = next.replace(/\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/g, (whole, q, spec) => {
        const t = target(spec);
        return t ? `import(${q}${t.to}${q})` : whole;
    });

    for (const sdk of ['app', 'auth', 'firestore', 'storage', 'functions', 'analytics']) {
        if (new RegExp(`['"]firebase/${sdk}['"]`).test(next)) problems.push(`imports firebase/${sdk}, which the game doesn't use any more`);
    }
    if (/['"]firebase['"]/.test(next)) problems.push('imports the firebase package itself, which is gone');
    return { text: next, changed: next !== text, problems };
}

function* jsFiles(dir) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === 'realtime' || name === 'node_modules') continue;
            yield* jsFiles(full);
        } else if (/\.(m?js)$/.test(name) && full !== path.join(SRC, 'firebase.js')) {
            yield full;
        }
    }
}

function main() {
    const checkOnly = process.argv.includes('--check');
    const changed = [];
    const problems = [];
    for (const file of jsFiles(SRC)) {
        const rel = path.relative(ROOT, file);
        const res = rewriteImports(readFileSync(file, 'utf8'), file);
        for (const p of res.problems) problems.push(`${rel}: ${p}`);
        if (res.changed) {
            changed.push(rel);
            if (!checkOnly) writeFileSync(file, res.text);
        }
    }
    let oldFile = false;
    try { oldFile = statSync(path.join(SRC, 'firebase.js')).isFile(); } catch { /* gone, as it should be */ }
    if (oldFile) problems.push('src/firebase.js is back (a merge kept it) — delete it; src/realtime/client.js replaced it');

    if (checkOnly) {
        if (changed.length || problems.length) {
            console.error('Firebase leftovers (run `npm run migrate:code`, see MIGRATION.md §5):');
            for (const f of changed) console.error(`  ${f}: Firebase import`);
            for (const p of problems) console.error(`  ${p}`);
            process.exit(1);
        }
        console.log('No Firebase imports — all game code uses src/realtime/.');
        return;
    }
    console.log(changed.length ? `Rewrote imports in ${changed.length} file(s):\n${changed.map(f => `  ${f}`).join('\n')}` : 'Nothing to rewrite.');
    if (problems.length) {
        console.error(`\nNeeds a human (MIGRATION.md §6):\n${problems.map(p => `  ${p}`).join('\n')}`);
        process.exitCode = 1;
    }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
