// scripts/ensure-setup.mjs
//
// Self-healing machine setup. Runs before dev, share, build and the tests
// (package.json pre* scripts) and fixes what a fresh checkout, another OS, or a
// `git pull` can leave behind:
//
//   1. node_modules missing, installed for another OS/CPU (it's per machine and
//      Dropbox-ignored), or older than package-lock.json  →  `npm install`
//   2. .dev.vars missing  →  copied from .dev.vars.example (local dev values);
//      a key the example has but .dev.vars lacks (added later) → appended
//   3. with --e2e: Playwright's Chromium missing  →  `npx playwright install chromium`
//
// Fast when everything is fine (a hash + a couple of file checks). Node
// built-ins only — it must run before anything is installed. Skipped in CI,
// where installs are managed by the pipeline.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.CI || process.env.WORKERS_CI) process.exit(0);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => path.join(root, ...p);
const marker = at('node_modules', '.picture-twirl-install.json');

function run(cmd, args) {
    // shell: true so npm/npx resolve on Windows (npm.cmd) as well as macOS/Linux.
    const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
    if (res.status !== 0) {
        console.error(`setup: \`${cmd} ${args.join(' ')}\` failed (exit ${res.status}).`);
        process.exit(res.status ?? 1);
    }
}

const lockHash = () => createHash('sha256').update(readFileSync(at('package-lock.json'))).digest('hex').slice(0, 16);

// ── 1. Dependencies ──────────────────────────────────────────────────────────
let installed = null;
try { installed = JSON.parse(readFileSync(marker, 'utf8')); } catch { /* not recorded yet */ }

const why = !existsSync(at('node_modules')) ? 'node_modules is missing'
    : !installed ? 'first check on this machine'
    : installed.platform !== process.platform || installed.arch !== process.arch
        ? `node_modules was installed for ${installed.platform}-${installed.arch}`
    : installed.lock !== lockHash() ? 'package-lock.json changed'
    : null;

if (why) {
    console.log(`setup: ${why} → npm install`);
    run('npm', ['install']);
    // Hash AFTER install: npm may rewrite the lockfile slightly.
    writeFileSync(marker, JSON.stringify({
        platform: process.platform, arch: process.arch, lock: lockHash(), installedAt: new Date().toISOString(),
    }, null, 2));
}

// ── 2. Local Worker secrets ──────────────────────────────────────────────────
if (!existsSync(at('.dev.vars')) && existsSync(at('.dev.vars.example'))) {
    copyFileSync(at('.dev.vars.example'), at('.dev.vars'));
    console.log('setup: created .dev.vars from .dev.vars.example (local dev values)');
} else if (existsSync(at('.dev.vars')) && existsSync(at('.dev.vars.example'))) {
    // An older .dev.vars may miss a secret added since (e.g. SESSION_SECRET for live
    // games): append the example's value. Existing values are never touched.
    const keysOf = (text) => new Set([...text.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map(m => m[1]));
    const mine = readFileSync(at('.dev.vars'), 'utf8');
    const have = keysOf(mine);
    const missing = readFileSync(at('.dev.vars.example'), 'utf8').split(/\r?\n/)
        .filter(line => { const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/); return m && !have.has(m[1]); });
    if (missing.length) {
        writeFileSync(at('.dev.vars'), `${mine.replace(/\s*$/, '')}\n# added by scripts/ensure-setup.mjs from .dev.vars.example\n${missing.join('\n')}\n`);
        console.log(`setup: added ${missing.map(l => l.split('=')[0].trim()).join(', ')} to .dev.vars (from .dev.vars.example)`);
    }
}

// ── 3. Browser for e2e tests ─────────────────────────────────────────────────
if (process.argv.includes('--e2e')) {
    const { chromium } = await import('@playwright/test');
    if (!existsSync(chromium.executablePath())) {
        console.log('setup: Playwright Chromium missing → npx playwright install chromium');
        run('npx', ['playwright', 'install', 'chromium']);
    }
}
