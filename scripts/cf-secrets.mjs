#!/usr/bin/env node
// scripts/cf-secrets.mjs — `npm run cf:secrets [-- --previews] [-- --new-session-secret]`
//
// Sets a site's secrets in one go, without ever printing one — the values
// reach wrangler on stdin. Production by default (the Worker's secrets);
// --previews = STAGING: the Preview base config every branch Preview starts
// from (WORKFLOW.md → Staging).
//   ADMIN_PASSWORD  the team's admin password — the one in .dev.vars
//   IMPORT_TOKEN    the content tools' key for that site — IMPORT_TOKEN_PROD /
//                   IMPORT_TOKEN_STAGING in .env.local, made and saved the first time
//   SESSION_SECRET  made once; kept on later runs (a new one signs everyone out
//                   and hosts lose their games) unless --new-session-secret
// Re-run it after changing the team password (both sites). Production needs the
// Worker to exist. Rules: planSecrets() in scripts/lib/cloudflare.mjs.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseEnvFile } from '../tools/content/lib/env.mjs';
import { cloudflareEnv, planSecrets, wranglerBin } from './lib/cloudflare.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: o } = parseArgs({ options: { 'new-session-secret': { type: 'boolean', default: false }, previews: { type: 'boolean', default: false } } });
const site = o.previews
    ? { label: 'the Preview base config (staging)', list: ['preview', 'base-config', 'secret', 'list', '--json'], bulk: ['preview', 'base-config', 'secret', 'bulk'], tokenKey: 'IMPORT_TOKEN_STAGING' }
    : { label: 'the production Worker', list: ['secret', 'list', '--format', 'json'], bulk: ['secret', 'bulk'], tokenKey: 'IMPORT_TOKEN_PROD' };
const fail = (msg) => { console.error(msg); process.exit(1); };

const cf = cloudflareEnv(ROOT);
if (cf.error) fail(cf.error);
const wrangler = (args, input) => spawnSync(process.execPath, [wranglerBin(ROOT), ...args], {
    cwd: ROOT, env: cf.env, encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
});

// Which secrets does it have already? (Names only — Cloudflare never returns values.)
const listed = wrangler(site.list);
if (listed.status !== 0) fail(`Couldn't list the secrets of ${site.label}${o.previews ? '' : ' — is the Worker deployed yet?'}\n${listed.stderr.trim().split('\n').slice(-6).join('\n')}`);
const existing = new Set(JSON.parse(listed.stdout.slice(listed.stdout.indexOf('['))).map(s => s.name ?? s));

const envLocal = path.join(ROOT, '.env.local');
const plan = planSecrets({
    devVars: parseEnvFile(path.join(ROOT, '.dev.vars')),
    exampleVars: parseEnvFile(path.join(ROOT, '.dev.vars.example')),
    savedImportToken: parseEnvFile(envLocal)[site.tokenKey],
    existing,
    newSessionSecret: o['new-session-secret'],
    random: () => randomBytes(32).toString('base64url'),
});
if (plan.problem) fail(plan.problem);

const res = wrangler(site.bulk, JSON.stringify(plan.secrets));
if (res.status !== 0 || /No content found/.test(res.stderr + res.stdout)) fail(`wrangler ${site.bulk.join(' ')} failed:\n${res.stderr.trim().split('\n').slice(-6).join('\n')}`);

if (plan.saveImportToken) {
    const before = existsSync(envLocal) ? readFileSync(envLocal, 'utf8') : '';
    appendFileSync(envLocal, `${before && !before.endsWith('\n') ? '\n' : ''}# Import key for the content tools; npm run cf:secrets set it as IMPORT_TOKEN on ${site.label}.\n${site.tokenKey}=${plan.saveImportToken}\n`);
}
console.log(`Set ${Object.keys(plan.secrets).join(', ')} on ${site.label}.${plan.secrets.SESSION_SECRET ? '' : ' SESSION_SECRET kept (--new-session-secret replaces it).'}${plan.saveImportToken ? `\nSaved ${site.tokenKey} in .env.local for the content tools.` : ''}`);
