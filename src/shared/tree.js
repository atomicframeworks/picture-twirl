// src/shared/tree.js
//
// The JSON tree a live game lives in — the same model Firebase's Realtime
// Database used, so the game code didn't have to change shape (PROPOSAL.md
// §8.4). Shared by the GameRoom Durable Object (worker/rooms/) and the
// browser's mirror of it (src/realtime/). Pure functions; never mutate input.
// -----------------------------------------------------------------------------
// Rules of the model (Firebase's):
//   • a path is "a/b/c"; "" is the root
//   • writing null (or undefined) deletes; empty objects don't exist
//   • a write is a list of ops [{ p, v }]: each REPLACES the value at its path
//     (set = one op; update = one op per key; remove = { p, v: null })
//   • sentinels resolved by the server when a write is applied:
//       { '.sv': 'timestamp' }               → the room's clock (ms)
//       { '.sv': { increment: n } }          → current number at that path + n
// -----------------------------------------------------------------------------

/** "a/b/c" | ['a','b'] → ['a','b','c'] (empty segments dropped). */
export function splitPath(path) {
    if (Array.isArray(path)) return path.filter(s => s !== '' && s != null).map(String);
    return String(path ?? '').split('/').filter(Boolean);
}

export const joinPath = (segs) => segs.join('/');

/** Valid key: what Firebase allowed (no . $ # [ ] /, not empty, ≤ 768 chars). */
export const isValidKey = (key) => typeof key === 'string' && key.length > 0 && key.length <= 768 && !/[.$#[\]/]/.test(key);

/** Value at a path, or null. */
export function getAt(tree, path) {
    let node = tree;
    for (const seg of splitPath(path)) {
        if (node === null || typeof node !== 'object') return null;
        node = node[seg];
        if (node === undefined) return null;
    }
    return node === undefined ? null : node;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Deep copy without nulls and without empty objects (Firebase never stores
 * either). Arrays are kept as arrays.
 */
export function normalize(value) {
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) return value.map(v => normalize(v));
    if (!isPlainObject(value)) return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        const n = normalize(v);
        if (n !== null) out[k] = n;
    }
    return Object.keys(out).length ? out : null;
}

/**
 * A new tree with `value` at `path` (null deletes and prunes now-empty
 * parents). Copies only the nodes along the path.
 */
export function setAt(tree, path, value) {
    const segs = splitPath(path);
    const v = normalize(value);
    if (!segs.length) return v;
    const write = (node, i) => {
        const obj = isPlainObject(node) ? { ...node } : {};
        const key = segs[i];
        if (i === segs.length - 1) {
            if (v === null) delete obj[key];
            else obj[key] = v;
        } else {
            const child = write(obj[key], i + 1);
            if (child === null) delete obj[key];
            else obj[key] = child;
        }
        return Object.keys(obj).length ? obj : null;
    };
    return write(tree, 0);
}

export const isTimestampSentinel = (v) => isPlainObject(v) && v['.sv'] === 'timestamp';
export const isIncrementSentinel = (v) => isPlainObject(v) && isPlainObject(v['.sv']) && typeof v['.sv'].increment === 'number';
const isSentinel = (v) => isTimestampSentinel(v) || isIncrementSentinel(v);

/** True if a value contains any server sentinel. */
export function hasSentinel(value) {
    if (isSentinel(value)) return true;
    if (value !== null && typeof value === 'object') return Object.values(value).some(hasSentinel);
    return false;
}

/**
 * Replace sentinels inside `value` (about to be written at `path`).
 * @param {any} value
 * @param {{ now: () => number, current: (path: string[]) => any }} ctx
 *   now: the room clock; current: the value at a path BEFORE this write
 * @param {string[]} [segs]  path of `value`
 */
export function resolveSentinels(value, ctx, segs = []) {
    if (isTimestampSentinel(value)) return ctx.now();
    if (isIncrementSentinel(value)) {
        const cur = ctx.current(segs);
        return (typeof cur === 'number' ? cur : 0) + value['.sv'].increment;
    }
    if (Array.isArray(value)) return value.map((v, i) => resolveSentinels(v, ctx, [...segs, String(i)]));
    if (isPlainObject(value)) {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = resolveSentinels(v, ctx, [...segs, k]);
        return out;
    }
    return value;
}

/**
 * Apply a write (ops in order) to a tree.
 * @param {any} tree
 * @param {Array<{ p: string, v: any }>} ops
 * @param {{ now: () => number }} [clock]  resolves sentinels; omit when none are expected
 * @returns {{ tree: any, changed: string[][] }}  changed = the op paths (segments)
 */
export function applyOps(tree, ops, clock = null) {
    let next = tree;
    const changed = [];
    for (const op of ops) {
        const segs = splitPath(op.p);
        let v = op.v === undefined ? null : op.v;
        if (clock && hasSentinel(v)) {
            const before = next;
            v = resolveSentinels(v, { now: clock.now, current: (sub) => getAt(before, [...segs, ...sub]) });
        }
        next = setAt(next, segs, v);
        changed.push(segs);
    }
    return { tree: next, changed };
}

/** Structural equality for JSON values. */
export function deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/** Does path `a` equal or contain path `b` (a is an ancestor of / equal to b)? */
export function isPrefix(a, b) {
    if (a.length > b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/** Do two paths overlap (one is an ancestor of, or equal to, the other)? */
export const overlaps = (a, b) => isPrefix(a, b) || isPrefix(b, a);

/** JSON size in bytes (UTF-8), for limits. */
export const byteSize = (value) => new TextEncoder().encode(JSON.stringify(value ?? null)).length;
