#!/usr/bin/env node
// scripts/cf-token.mjs — `npm run cf:token [-- --account <id>]`
//
// Stores the Picture Twirl Cloudflare API token for this project's commands
// (`npm run cf -- …`) WITHOUT touching this machine's wrangler login — another
// project deploys from this machine with that login, so never `wrangler logout`
// or `wrangler login` here.
//
// From a phone: make the token in the Picture Twirl account (COMMANDS.md →
// Cloudflare), save it as a plain text file named `cloudflare-token.txt` in the
// project folder (it's gitignored), then run this. It checks the token with
// Cloudflare, finds its account, writes ~/.config/picture-twirl/cloudflare.env
// (outside Dropbox, readable only by you) and deletes the text file.
// The token is never printed.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CREDENTIALS = path.join(os.homedir(), '.config', 'picture-twirl', 'cloudflare.env');
const INBOX = path.join(ROOT, 'cloudflare-token.txt');
const API = 'https://api.cloudflare.com/client/v4';

const { values: o } = parseArgs({ options: { account: { type: 'string' } } });

if (!existsSync(INBOX)) {
    console.error(`No ${path.basename(INBOX)} in the project folder.
Make a token in the Picture Twirl Cloudflare account (COMMANDS.md → Cloudflare),
save it as a plain text file named cloudflare-token.txt in the picture-twirl
folder (Dropbox works from a phone), then run: npm run cf:token`);
    process.exit(1);
}

const token = readFileSync(INBOX, 'utf8').trim();
if (!/^[A-Za-z0-9_-]{30,}$/.test(token)) {
    console.error(`${path.basename(INBOX)} doesn't look like a Cloudflare API token (just the token, nothing else).`);
    process.exit(1);
}

async function cf(p) {
    const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.success !== false, body };
}

const verify = await cf('/user/tokens/verify');
if (verify.ok && verify.body.result?.status && verify.body.result.status !== 'active') {
    console.error(`The token isn't active (status: ${verify.body.result.status}). Make a new one.`);
    process.exit(1);
}
const accounts = await cf('/accounts?per_page=50');
if (!accounts.ok) {
    console.error(`Cloudflare didn't accept the token (${accounts.body.errors?.map(e => e.message).join('; ') || 'no details'}).
Check that it has "Account Settings: Read" and is limited to the Picture Twirl account.`);
    process.exit(1);
}
const list = accounts.body.result || [];
let account = o.account ? list.find(a => a.id === o.account) : (list.length === 1 ? list[0] : null);
if (!account) {
    console.error(list.length > 1
        ? `The token reaches ${list.length} accounts — limit it to the Picture Twirl account, or pick one:\n${list.map(a => `  npm run cf:token -- --account ${a.id}   # ${a.name}`).join('\n')}`
        : 'The token reaches no account. Give it "Account Settings: Read" on the Picture Twirl account.');
    process.exit(1);
}

mkdirSync(path.dirname(CREDENTIALS), { recursive: true, mode: 0o700 });
const expires = verify.body.result?.expires_on ? new Date(verify.body.result.expires_on).toISOString().slice(0, 10) : 'no expiry date';
writeFileSync(CREDENTIALS, `# Picture Twirl — Cloudflare API token for this project's wrangler commands (npm run cf -- …).
# Account: ${account.name} (${account.id}). Stored ${new Date().toISOString().slice(0, 10)}; token expires: ${expires}.
# Outside Dropbox on purpose. Revoke the token in the Cloudflare dashboard when it's no longer needed.
CLOUDFLARE_API_TOKEN=${token}
CLOUDFLARE_ACCOUNT_ID=${account.id}
`, { mode: 0o600 });
chmodSync(CREDENTIALS, 0o600);
rmSync(INBOX, { force: true });

console.log(`Stored the token for account “${account.name}” (${account.id}) — expires: ${expires}.
  credentials: ${CREDENTIALS} (only you can read it; not in Dropbox)
  removed:     ${path.basename(INBOX)} from the project folder
Check it:  npm run cf -- whoami`);
