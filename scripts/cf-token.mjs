#!/usr/bin/env node
// scripts/cf-token.mjs — `npm run cf:token`
//
// Checks the Picture Twirl Cloudflare API token in cloudflare-token.txt (the
// project folder; scripts/lib/cloudflare.mjs): is it active, which account does it
// reach, is that the account wrangler.jsonc pins (`account_id`) — the one
// `npm run cf` works on — and what's its workers.dev subdomain (the site's
// address before a custom domain). Read-only; never prints the token. Handles
// user tokens and account-owned tokens (`cfat_…`).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken, tokenHelp } from './lib/cloudflare.mjs';
import { readWranglerConfig } from './lib/wranglerConfig.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.cloudflare.com/client/v4';

const found = readToken(ROOT);
if (!found.token) {
    console.error(tokenHelp(found));
    process.exit(1);
}
const config = readWranglerConfig(ROOT);
const pinned = config.account_id || null;

async function cf(p) {
    const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${found.token}` } });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.success !== false, body };
}

// Which accounts does it reach? (An account-owned token may not list accounts: then ask for the pinned one.)
const accounts = await cf('/accounts?per_page=50');
let list = accounts.ok ? (accounts.body.result || []) : [];
if (!list.length && pinned) {
    const one = await cf(`/accounts/${pinned}`);
    if (one.ok && one.body.result) list = [one.body.result];
}
if (!list.length) {
    console.error(`Cloudflare didn't accept the token (${accounts.body.errors?.map(e => e.message).join('; ') || 'no details'}).
It needs "Account Settings: Read" on the Picture Twirl account (COMMANDS.md → Cloudflare).`);
    process.exit(1);
}
const account = pinned ? list.find(a => a.id === pinned) : (list.length === 1 ? list[0] : null);

// Active? User tokens verify at /user/tokens/verify, account-owned (cfat_…) at /accounts/:id/tokens/verify.
let verify = await cf('/user/tokens/verify');
if (!verify.ok) verify = await cf(`/accounts/${(account || list[0]).id}/tokens/verify`);
const status = verify.ok ? verify.body.result?.status || 'unknown' : 'unknown';
const expires = verify.body.result?.expires_on ? new Date(verify.body.result.expires_on).toISOString().slice(0, 10) : (verify.ok ? 'never' : 'unknown');

console.log(`Token in ${path.basename(found.file)}: status ${status}, expires ${expires}. Reaches:
${list.map(a => `  ${a.name}  (${a.id})${a.id === pinned ? '  ← wrangler.jsonc account_id' : ''}`).join('\n')}`);
if (status !== 'active' && status !== 'unknown') {
    console.error('The token isn\'t active — make a new one (COMMANDS.md → Cloudflare).');
    process.exit(1);
}
if (!pinned) {
    console.log(list.length === 1
        ? `wrangler.jsonc has no account_id yet. If “${list[0].name}” is the Picture Twirl account, pin it: "account_id": "${list[0].id}"`
        : 'wrangler.jsonc has no account_id yet — pin the Picture Twirl account\'s id there.');
    process.exit(1);
}
if (!account) {
    console.error(`This token doesn't reach the pinned account ${pinned} — wrong token, or wrong account_id.`);
    process.exit(1);
}

const sub = await cf(`/accounts/${account.id}/workers/subdomain`);
console.log(sub.ok && sub.body.result?.subdomain
    ? `workers.dev subdomain: ${sub.body.result.subdomain} → the site is https://${config.name}.${sub.body.result.subdomain}.workers.dev`
    : `workers.dev subdomain: none yet (or the token can't see it: ${sub.body.errors?.map(e => e.message).join('; ') || 'no details'}) — set one under Workers & Pages before the first deploy.`);
console.log(`OK — \`npm run cf -- …\` works on “${account.name}”.`);
