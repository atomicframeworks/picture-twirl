#!/usr/bin/env node
// scripts/cf-secrets.mjs — `npm run cf:secrets [-- --new-session-secret]`
//
// Sets the production Worker's secrets (PROPOSAL.md §9.2) in one go, without
// ever printing one: the values reach `wrangler secret bulk` on stdin.
//   ADMIN_PASSWORD  the team's admin password — the one in .dev.vars
//   IMPORT_TOKEN    the content tools' production key — IMPORT_TOKEN_PROD in
//                   .env.local, made and saved there the first time
//   SESSION_SECRET  made once; kept on later runs (a new one signs everyone out
//                   and hosts lose their games) unless --new-session-secret
// Re-run it after changing the team password. The Worker must exist (first
// deploy: `npm run build && npm run cf -- deploy`). Rules: planSecrets() in
// scripts/lib/cloudflare.mjs.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseEnvFile } from '../tools/content/lib/env.mjs';
import { cloudflareEnv, planSecrets, wranglerBin } from './lib/cloudflare.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: o } = parseArgs({ options: { 'new-session-secret': { type: 'boolean', default: false } } });
const fail = (msg) => { console.error(msg); process.exit(1); };

const cf = cloudflareEnv(ROOT);
if (cf.error) fail(cf.error);
const wrangler = (args, input) => spawnSync(process.execPath, [wranglerBin(ROOT), ...args], {
    cwd: ROOT, env: cf.env, encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
});

// Which secrets does the Worker have already? (Names only — Cloudflare never returns values.)
const listed = wrangler(['secret', 'list', '--format', 'json']);
if (listed.status !== 0) fail(`Couldn't list the Worker's secrets — is it deployed yet? (npm run build && npm run cf -- deploy)\n${listed.stderr.trim().split('\n').slice(-6).join('\n')}`);
const existing = new Set(JSON.parse(listed.stdout.slice(listed.stdout.indexOf('['))).map(s => s.name));

const envLocal = path.join(ROOT, '.env.local');
const plan = planSecrets({
    devVars: parseEnvFile(path.join(ROOT, '.dev.vars')),
    exampleVars: parseEnvFile(path.join(ROOT, '.dev.vars.example')),
    prodImportToken: parseEnvFile(envLocal).IMPORT_TOKEN_PROD,
    existing,
    newSessionSecret: o['new-session-secret'],
    random: () => randomBytes(32).toString('base64url'),
});
if (plan.problem) fail(plan.problem);

const res = wrangler(['secret', 'bulk'], JSON.stringify(plan.secrets));
if (res.status !== 0) fail(`wrangler secret bulk failed:\n${res.stderr.trim().split('\n').slice(-6).join('\n')}`);

if (plan.saveImportToken) {
    const before = existsSync(envLocal) ? readFileSync(envLocal, 'utf8') : '';
    appendFileSync(envLocal, `${before && !before.endsWith('\n') ? '\n' : ''}# Production import key for the content tools (--site prod); npm run cf:secrets set it as the Worker's IMPORT_TOKEN.\nIMPORT_TOKEN_PROD=${plan.saveImportToken}\n`);
}
console.log(`Set ${Object.keys(plan.secrets).join(', ')} on the Worker.${plan.secrets.SESSION_SECRET ? '' : ' SESSION_SECRET kept (--new-session-secret replaces it).'}${plan.saveImportToken ? '\nSaved IMPORT_TOKEN_PROD in .env.local for the content tools.' : ''}`);
