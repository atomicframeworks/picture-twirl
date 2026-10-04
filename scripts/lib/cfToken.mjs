// scripts/lib/cfToken.mjs — the Picture Twirl Cloudflare API token for
// `npm run cf` / `npm run cf:token`.
//
// It lives in cloudflare-token.txt in the project folder: gitignored (never
// committed — GitHub refuses pushes that contain Cloudflare tokens), shared
// between the team's machines by Dropbox (the owner's call, 2026-10-03).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

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
