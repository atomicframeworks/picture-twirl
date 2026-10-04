#!/usr/bin/env node
// scripts/cf.mjs — `npm run cf -- <wrangler args>`   e.g. `npm run cf -- whoami`
//
// wrangler against the PICTURE TWIRL Cloudflare account only. The account's API
// token (cloudflare-token.txt in the project folder — scripts/lib/cfToken.mjs)
// and wrangler.jsonc's account_id are handed to this one command as
// CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID — wrangler then uses them instead
// of its login. This machine's own wrangler login (another project deploys with
// it) is never used or changed: never `wrangler login` / `logout` here.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken, tokenHelp } from './lib/cfToken.mjs';
import { readWranglerConfig } from './lib/wranglerConfig.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const found = readToken(ROOT);
if (!found.token) {
    console.error(tokenHelp(found));
    process.exit(1);
}
const account = readWranglerConfig(ROOT).account_id;
if (!account) {
    console.error('wrangler.jsonc has no account_id. `npm run cf:token` shows the token\'s account — pin that one first.');
    process.exit(1);
}

const args = process.argv.slice(2);
console.error(`[cf] Picture Twirl account ${account} — wrangler ${args.join(' ')}`);
const res = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, CLOUDFLARE_API_TOKEN: found.token, CLOUDFLARE_ACCOUNT_ID: account },
});
process.exit(res.status ?? 1);
