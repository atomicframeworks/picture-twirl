// worker/lib/auth.js
//
// /admin authentication (PROPOSAL.md §5.1).
// -----------------------------------------------------------------------------
// - One shared password (Worker secret ADMIN_PASSWORD) + a "who's editing" name
//   that goes into the session and the audit log.
// - Session = HMAC-SHA256-signed token (secret SESSION_SECRET) in an HttpOnly,
//   SameSite=Strict cookie, 7 days. No session table: logging out clears the
//   cookie; changing SESSION_SECRET signs everyone out.
// - Failed sign-ins are rate-limited per IP (10 per 15 minutes, D1
//   login_attempts).
// - Admin is OFF (503) unless both secrets are set.
// Web Crypto only, so it runs in workerd and in Node (tests).
// -----------------------------------------------------------------------------

import { HttpError } from './http.js';
import { now } from './db.js';

export const SESSION_COOKIE = 'pt_admin';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 10;
export const NAME_MAX = 40;

const enc = new TextEncoder();

export const adminConfigured = (env) => !!(env.ADMIN_PASSWORD && env.SESSION_SECRET);

function b64url(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, c => c.charCodeAt(0));
}

const keyCache = new Map();
async function hmacKey(secret) {
    if (!keyCache.has(secret)) {
        keyCache.set(secret, crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
    }
    return keyCache.get(secret);
}

/** Compare two strings in constant time (hash both, compare the digests). */
export async function safeEqual(a, b) {
    const [da, db] = await Promise.all([
        crypto.subtle.digest('SHA-256', enc.encode(String(a))),
        crypto.subtle.digest('SHA-256', enc.encode(String(b))),
    ]);
    const x = new Uint8Array(da);
    const y = new Uint8Array(db);
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
}

/** Signed session token: base64url(payload).base64url(hmac). */
export async function signSession(env, { name }, issuedAt = now()) {
    const payload = b64url(enc.encode(JSON.stringify({ n: name, iat: issuedAt, exp: issuedAt + SESSION_TTL_MS })));
    const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(payload));
    return `${payload}.${b64url(new Uint8Array(sig))}`;
}

/** The session ({ name, iat, exp }) if the token is genuine and unexpired, else null. */
export async function verifySession(env, token) {
    if (!token || !adminConfigured(env)) return null;
    const [payload, sig] = String(token).split('.');
    if (!payload || !sig) return null;
    try {
        const sigBytes = fromB64url(sig);
        // Only the canonical encoding is valid (no alternate spellings of the same bytes).
        if (b64url(sigBytes) !== sig) return null;
        const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), sigBytes, enc.encode(payload));
        if (!ok) return null;
        const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
        if (typeof data.exp !== 'number' || data.exp < now()) return null;
        return { name: String(data.n || 'admin'), iat: data.iat, exp: data.exp };
    } catch {
        return null;
    }
}

export function readCookie(request, name) {
    for (const part of (request.headers.get('Cookie') || '').split(';')) {
        const i = part.indexOf('=');
        if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return '';
}

/** Set-Cookie value for the session (maxAgeSec 0 clears it). */
export function sessionCookie(request, token, maxAgeSec) {
    const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}

const clientIp = (request) => request.headers.get('CF-Connecting-IP') || 'local';
const windowStart = (t) => t - (t % LOGIN_WINDOW_MS);

/** Throw 429 when this IP has failed too often in the current window. */
export async function assertLoginAllowed(env, request) {
    const row = await env.DB.prepare('SELECT count FROM login_attempts WHERE ip = ? AND window_start = ?')
        .bind(clientIp(request), windowStart(now())).first();
    if ((row?.count ?? 0) >= LOGIN_MAX_FAILURES) {
        throw new HttpError(429, 'too_many_attempts', 'Too many wrong passwords. Try again in 15 minutes.');
    }
}

export async function recordLoginFailure(env, request) {
    const t = now();
    await env.DB.batch([
        env.DB.prepare(`INSERT INTO login_attempts (ip, window_start, count) VALUES (?, ?, 1)
            ON CONFLICT (ip, window_start) DO UPDATE SET count = count + 1`).bind(clientIp(request), windowStart(t)),
        env.DB.prepare('DELETE FROM login_attempts WHERE window_start < ?').bind(t - 24 * 60 * 60 * 1000),
    ]);
}

/**
 * Gate for every /api/admin/* route except login/logout.
 * @returns {Promise<{ name: string }>} the session
 */
export async function requireAdmin(request, env) {
    if (!adminConfigured(env)) throw new HttpError(503, 'admin_not_configured', 'The admin is not set up on this server.');

    // CSRF: the cookie is SameSite=Strict; additionally refuse cross-site
    // writes that announce a foreign Origin.
    if (!['GET', 'HEAD'].includes(request.method)) {
        const origin = request.headers.get('Origin');
        if (origin && origin !== 'null' && new URL(origin).host !== new URL(request.url).host) {
            throw new HttpError(403, 'bad_origin', 'Cross-site request refused.');
        }
    }

    const session = await verifySession(env, readCookie(request, SESSION_COOKIE));
    if (!session) throw new HttpError(401, 'signed_out', 'Please sign in.');
    return session;
}
