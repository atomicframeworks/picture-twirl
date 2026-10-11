// tests/unit/docs.test.mjs — the docs can't silently drift from the code
// (CLAUDE.md: "documentation drift is a known past problem here"). Every Markdown
// doc in the repo root (+ .claude/skills) is checked for:
//   - `npm run <script>` mentions → the script exists in package.json
//   - links to local files → the file exists
//   - repo paths in backticks (src/…, worker/…, scripts/…) → the file or folder exists
// Placeholders (<run>, *, …) are skipped. Fix the doc, or the code, when this fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scripts = new Set(Object.keys(JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts));

function mdFiles(dir, deep) {
    return readdirSync(dir).flatMap((name) => {
        const p = path.join(dir, name);
        if (name === 'node_modules' || name.startsWith('.git')) return [];
        if (statSync(p).isDirectory()) return deep ? mdFiles(p, deep) : [];
        return name.endsWith('.md') ? [p] : [];
    });
}
const DOCS = [...mdFiles(ROOT, false), ...(existsSync(path.join(ROOT, '.claude')) ? mdFiles(path.join(ROOT, '.claude'), true) : [])];
const rel = (p) => path.relative(ROOT, p);
const isPlaceholder = (s) => /[<>*…{}$]|\.\.\.|\bx\b/.test(s);
// Records of the past (audit, change log, the switch-over plan — which also names
// files in sister projects): their scripts and links are checked, file names aren't.
const HISTORY = new Set(['AUDIT.md', 'REFACTOR.md', 'PROPOSAL.md']);
// Deleted by the switch-over and named on purpose (MIGRATION.md tells old branches what happened to them).
const REMOVED = new Set(['src/firebase.js', 'src/predefinedGames.js']);

test('there are docs to check', () => {
    assert.ok(DOCS.some(d => rel(d) === 'README.md') && DOCS.length >= 8, DOCS.map(rel).join(', '));
});

test('every `npm run <script>` the docs mention exists in package.json', () => {
    const bad = [];
    for (const doc of DOCS) {
        for (const m of readFileSync(doc, 'utf8').matchAll(/npm run(?: -s)? ([a-z][\w:.*-]*)/g)) {
            if (!isPlaceholder(m[1]) && !scripts.has(m[1])) bad.push(`${rel(doc)}: npm run ${m[1]}`);
        }
    }
    assert.deepEqual([...new Set(bad)], []);
});

test('every link to a local file resolves', () => {
    const bad = [];
    for (const doc of DOCS) {
        for (const m of readFileSync(doc, 'utf8').matchAll(/\]\(([^)\s]+)\)/g)) {
            const target = m[1].split('#')[0];
            if (!target || /^[a-z]+:/i.test(target) || isPlaceholder(target)) continue;
            if (!existsSync(path.resolve(path.dirname(doc), decodeURI(target)))) bad.push(`${rel(doc)}: (${m[1]})`);
        }
    }
    assert.deepEqual([...new Set(bad)], []);
});

test('every repo path the docs name in backticks exists', () => {
    const TOP = /^(src|worker|scripts|tests|tools|migrations|admin|public|content\/seed|content\/sources|\.claude)\//;
    const bad = [];
    for (const doc of DOCS.filter(d => !HISTORY.has(rel(d)))) {
        for (const m of readFileSync(doc, 'utf8').matchAll(/`([^`\s]+)`/g)) {
            const p = m[1].replace(/[:,.]+$/, '').replace(/:\d+(-\d+)?$/, '');
            if (!TOP.test(p) || isPlaceholder(p) || REMOVED.has(p)) continue;
            if (!existsSync(path.join(ROOT, p))) bad.push(`${rel(doc)}: ${m[1]}`);
        }
    }
    assert.deepEqual([...new Set(bad)], []);
});
