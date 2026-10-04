// scripts/lib/cloudflare.mjs — talking to the Picture Twirl Cloudflare account
// (`npm run cf`, `cf:token`, `cf:secrets`).
//
// The account's API token lives in cloudflare-token.txt in the project folder:
// gitignored (never committed — GitHub refuses pushes that contain Cloudflare
// tokens), shared between the team's machines by Dropbox (the owner's call,
// 2026-10-03). wrangler gets it — and wrangler.jsonc's account_id — per command,
// so a machine's own wrangler login (maybe another account) is never used.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readWranglerConfig } from './wranglerConfig.mjs';

export const TOKEN_FILE = 'cloudflare-token.txt';

/**
 * The API token in cloudflare-token.txt's text. The file may hold just the
 * token, or everything Cloudflare showed when it was made (token, R2 access
 * key + secret, endpoint) — then the prefixed API token (`cfat_…`, `cfut_…`)
 * is the one. Null when there's no single token to pick.
 * @param {string} text
 * @returns {string|null}
 */
export function tokenFromText(text) {
    const prefixed = [...new Set(String(text).match(/(?<![A-Za-z0-9_-])cf[a-z]{1,3}_[A-Za-z0-9_-]{20,}/g) || [])];
    if (prefixed.length) return prefixed.length === 1 ? prefixed[0] : null;
    const plain = String(text).trim();
    return /^[A-Za-z0-9_-]{30,}$/.test(plain) ? plain : null;
}

/**
 * @param {string} root  project root
 * @returns {{ file: string, exists: boolean, token: string|null }}
 */
export function readToken(root) {
    const file = path.join(root, TOKEN_FILE);
    if (!existsSync(file)) return { file, exists: false, token: null };
    return { file, exists: true, token: tokenFromText(readFileSync(file, 'utf8')) };
}

/** What to tell someone whose token file is missing or unreadable. */
export function tokenHelp({ file, exists }) {
    return exists
        ? `${path.basename(file)} doesn't hold one Cloudflare API token. Put just the token in it
(or everything Cloudflare showed when you made it — the cfat_… / cfut_… line is used).`
        : `No ${path.basename(file)} in the project folder yet. Make an API token in the
Picture Twirl Cloudflare account (COMMANDS.md → Cloudflare) and save it as a plain
text file named ${path.basename(file)} in the picture-twirl folder (the Dropbox app
works from a phone). Then: npm run cf:token`;
}

/**
 * The environment that points wrangler at the Picture Twirl account: the token +
 * the account_id pinned in wrangler.jsonc. `{ error }` when either is missing.
 * @param {string} root
 * @returns {{ account?: string, env?: NodeJS.ProcessEnv, error?: string }}
 */
export function cloudflareEnv(root) {
    const found = readToken(root);
    if (!found.token) return { error: tokenHelp(found) };
    const account = readWranglerConfig(root).account_id;
    if (!account) return { error: 'wrangler.jsonc has no account_id. `npm run cf:token` shows the token\'s account — pin that one first.' };
    return { account, env: { ...process.env, CLOUDFLARE_API_TOKEN: found.token, CLOUDFLARE_ACCOUNT_ID: account } };
}

/** The project's own wrangler (node_modules), run with `node`. */
export const wranglerBin = (root) => path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

/**
 * Which secrets `npm run cf:secrets` sends to the production Worker.
 * - ADMIN_PASSWORD: the team's password from .dev.vars (the same one locally and
 *   in production) — never the .dev.vars.example placeholder.
 * - IMPORT_TOKEN: the content tools' production key, kept in .env.local as
 *   IMPORT_TOKEN_PROD; made the first time (`saveImportToken`).
 * - SESSION_SECRET: signs player identities and admin sessions. Only when the
 *   Worker has none yet, or asked for: a new one signs everyone out, and hosts
 *   of running games lose their seat.
 * @param {{ devVars: Record<string,string>, exampleVars: Record<string,string>,
 *   prodImportToken?: string, existing: Set<string>, newSessionSecret?: boolean,
 *   random: () => string }} input
 * @returns {{ secrets: Record<string,string>, saveImportToken: string|null, problem: string|null }}
 */
export function planSecrets({ devVars, exampleVars, prodImportToken, existing, newSessionSecret = false, random }) {
    const password = devVars.ADMIN_PASSWORD;
    if (!password || password === exampleVars.ADMIN_PASSWORD) {
        return { secrets: {}, saveImportToken: null, problem: 'Put the team\'s admin password in .dev.vars (ADMIN_PASSWORD=…) first — production uses the same one.' };
    }
    const importToken = prodImportToken || random();
    const secrets = { ADMIN_PASSWORD: password, IMPORT_TOKEN: importToken };
    if (newSessionSecret || !existing.has('SESSION_SECRET')) secrets.SESSION_SECRET = random();
    return { secrets, saveImportToken: prodImportToken ? null : importToken, problem: null };
}
