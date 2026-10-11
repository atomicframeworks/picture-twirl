// worker/lib/db.js
//
// Thin helpers over the D1 binding (env.DB). Also used by Node scripts through
// wrangler's getPlatformProxy(), so keep this free of Worker-only APIs.

export const now = () => Date.now();

/** Random id with a readable prefix: newId('brd') → 'brd_k3v9…'. */
export function newId(prefix) {
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let out = '';
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return `${prefix}_${out}`;
}

export const first = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
export const run = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).run();

export async function all(env, sql, ...args) {
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    return results ?? [];
}

/** Append to the audit log (who did what). */
export function audit(env, { actor = null, action, boardId = null, detail = null }) {
    return run(env,
        'INSERT INTO audit_log (at, actor, action, board_id, detail) VALUES (?, ?, ?, ?, ?)',
        now(), actor, action, boardId, detail == null ? null : JSON.stringify(detail));
}

/** SHA-256 hex of bytes (Web Crypto: works in workerd and Node ≥ 20). */
export async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
