#!/usr/bin/env node
// scripts/cf.mjs — `npm run cf -- <wrangler args>`   e.g. `npm run cf -- whoami`
//
// wrangler against the PICTURE TWIRL Cloudflare account only. The account's API
// token (cloudflare-token.txt in the project folder — scripts/lib/cloudflare.mjs)
// and wrangler.jsonc's account_id are handed to this one command as
// CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID — wrangler then uses them instead
// of its login. This machine's own wrangler login (another project deploys with
// it) is never used or changed: never `wrangler login` / `logout` here.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareEnv, wranglerBin } from './lib/cloudflare.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const cf = cloudflareEnv(ROOT);
if (cf.error) {
    console.error(cf.error);
    process.exit(1);
}

const args = process.argv.slice(2);
console.error(`[cf] Picture Twirl account ${cf.account} — wrangler ${args.join(' ')}`);
const res = spawnSync(process.execPath, [wranglerBin(ROOT), ...args], { cwd: ROOT, stdio: 'inherit', env: cf.env });
process.exit(res.status ?? 1);
