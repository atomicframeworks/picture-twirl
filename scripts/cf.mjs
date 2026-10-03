#!/usr/bin/env node
// scripts/cf.mjs — `npm run cf -- <wrangler args>`   e.g. `npm run cf -- whoami`
//
// wrangler against the PICTURE TWIRL Cloudflare account only. The token from
// ~/.config/picture-twirl/cloudflare.env (stored by `npm run cf:token`) is
// handed to this one command as CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID —
// wrangler then uses it instead of its login. This machine's own wrangler
// login (another project deploys with it) is never used or changed.
// Refuses to run if wrangler.jsonc's account_id is pinned to a different account.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnvFile } from '../tools/content/lib/env.mjs';
import { readWranglerConfig } from './lib/wranglerConfig.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CREDENTIALS = path.join(os.homedir(), '.config', 'picture-twirl', 'cloudflare.env');

const creds = existsSync(CREDENTIALS) ? parseEnvFile(CREDENTIALS) : {};
if (!creds.CLOUDFLARE_API_TOKEN || !creds.CLOUDFLARE_ACCOUNT_ID) {
    console.error(`No Picture Twirl Cloudflare token yet (${CREDENTIALS}).
Make one in the Picture Twirl account (COMMANDS.md → Cloudflare), save it as
cloudflare-token.txt in the project folder, then: npm run cf:token`);
    process.exit(1);
}

const pinned = readWranglerConfig(ROOT).account_id;
if (pinned && pinned !== creds.CLOUDFLARE_ACCOUNT_ID) {
    console.error(`wrangler.jsonc is pinned to account ${pinned}, but the stored token is for ${creds.CLOUDFLARE_ACCOUNT_ID}. Refusing.`);
    process.exit(1);
}

const args = process.argv.slice(2);
console.error(`[cf] Picture Twirl account ${creds.CLOUDFLARE_ACCOUNT_ID} — wrangler ${args.join(' ')}`);
const res = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, CLOUDFLARE_API_TOKEN: creds.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: creds.CLOUDFLARE_ACCOUNT_ID },
});
process.exit(res.status ?? 1);
