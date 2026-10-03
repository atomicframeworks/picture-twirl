// worker/rooms/roomCore.js
//
// The rules and views of one live game room — pure logic with no Cloudflare
// APIs, so every rule is unit-tested in Node (tests/unit/roomCore.test.mjs).
// GameRoom.js (the Durable Object) wraps it with storage, sockets and alarms.
// PROPOSAL.md §8.4; the old Firebase rules it replaces (and tightens):
// worker/rooms/firebase-rules.legacy.jsonc.
// -----------------------------------------------------------------------------
// WHO MAY WRITE WHAT
//   nobody yet (empty room)  → only "create": a root write whose hostUid is you
//                              (and the code isn't reserved for someone else)
//   the host (tree.hostUid)  → anything, except giving the room away
//                              (deleting the whole room is allowed)
//   a player                 → their OWN participants/<uid> row — whitelisted
//                              fields and values only (no isGM, no points, no
//                              self-approval) — and adding ONE buzz while a
//                              question is open
// WHAT EACH ONE SEES
//   the host  → everything
//   a player  → everything except answers (board/*/answer, and
//               currentQuestion/answer until showAnswer) and upcoming pictures
//               (board/*/imageUrl): the old rules let anyone read them (AUDIT M7)
// -----------------------------------------------------------------------------

import { LIMITS as GAME_LIMITS, TEAM } from '../../src/config.js';
import { applyOps, byteSize, deepEqual, getAt, isPrefix, isValidKey, splitPath } from '../../src/shared/tree.js';

export const ROOM_LIMITS = {
    OPS_PER_WRITE: 300,
    HOST_WRITE_BYTES: 256 * 1024,      // a whole board with answers is ~10–40 KB
    PLAYER_WRITE_BYTES: 4 * 1024,
    TREE_BYTES: 1024 * 1024,
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const deny = (code, message) => ({ ok: false, code, message });

/** 'host' | 'player' (anyone else with an identity) | 'guest' (no identity). */
export function roleOf(tree, uid) {
    if (!uid) return 'guest';
    return tree?.hostUid === uid ? 'host' : 'player';
}

const phaseOf = (tree) => tree?.state?.phase ?? null;

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Check and apply one write.
 * @param {any} tree  current room tree (null = the room doesn't exist yet)
 * @param {Array<{ p: string, v: any }>} ops  room-relative paths
 * @param {{ uid: string, now: () => number, claimedBy?: string|null }} ctx
 *   claimedBy: who reserved this (empty) room's code, if anyone
 * @returns {{ ok: true, tree: any, changed: string[][], noop: boolean } | { ok: false, code: string, message: string }}
 */
export function applyWrite(tree, ops, { uid, now, claimedBy = null }) {
    if (!uid) return deny('signed_out', 'No player identity.');
    if (!Array.isArray(ops) || ops.length === 0) return deny('bad_write', 'Nothing to write.');
    if (ops.length > ROOM_LIMITS.OPS_PER_WRITE) return deny('too_large', 'Too many changes at once.');
    for (const op of ops) {
        if (!isPlainObject(op) || typeof op.p !== 'string') return deny('bad_write', 'Malformed change.');
        if (!splitPath(op.p).every(isValidKey)) return deny('bad_path', `Bad path "${op.p}".`);
    }
    const role = roleOf(tree, uid);
    const maxBytes = role === 'host' || tree === null ? ROOM_LIMITS.HOST_WRITE_BYTES : ROOM_LIMITS.PLAYER_WRITE_BYTES;
    if (byteSize(ops) > maxBytes) return deny('too_large', 'That change is too large.');

    const { tree: after, changed } = applyOps(tree, ops, { now });

    const verdict = tree === null ? checkCreate(after, uid, claimedBy)
        : role === 'host' ? checkHost(tree, after, uid)
            : checkPlayer(tree, after, changed, uid);
    if (!verdict.ok) return verdict;
    if (after !== null && byteSize(after) > ROOM_LIMITS.TREE_BYTES) return deny('too_large', 'This game has grown too large.');
    return { ok: true, tree: after, changed, noop: deepEqual(tree, after) };
}

function checkCreate(after, uid, claimedBy) {
    if (after === null) return { ok: true };          // nothing happened (e.g. removing in an empty room)
    if (!isPlainObject(after) || after.hostUid !== uid) {
        return deny('permission_denied', 'This game doesn’t exist (anymore).');
    }
    if (claimedBy && claimedBy !== uid) return deny('code_taken', 'That game code is reserved for someone else.');
    return { ok: true };
}

function checkHost(before, after, uid) {
    if (after === null) return { ok: true };          // the host may delete the whole game
    if (after.hostUid !== uid) return deny('permission_denied', 'The host can’t give the game away.');
    return { ok: true };
}

/** What a player may put in their own participants/<uid> row. */
const PLAYER_FIELDS = {
    displayName: (v) => typeof v === 'string' && v.length <= GAME_LIMITS.DISPLAY_NAME,
    team: (v) => v === TEAM.A || v === TEAM.B || v === TEAM.NONE,
    online: (v) => typeof v === 'boolean',
    lastSeen: (v) => typeof v === 'number',
    joinedAt: (v) => typeof v === 'number',
    isGM: (v) => v === false,
    status: (v) => v === 'pending',
    tileRequest: (v) => isPlainObject(v)
        && Object.keys(v).every(k => k === 'id' || k === 'category' || k === 'value')
        && typeof v.id === 'string' && v.id.length <= 20
        && (v.category === undefined || (typeof v.category === 'string' && v.category.length <= 80))
        && (v.value === undefined || typeof v.value === 'number'),
    playAgainVote: (v) => v === 'yes' || v === 'no',
};
/** What a player may delete from their own row (others are the host's to change). */
const PLAYER_DELETABLE = new Set(['tileRequest', 'eligibleFromQuestionId', 'playAgainVote', 'online', 'lastSeen']);

function checkPlayer(before, after, changed, uid) {
    for (const segs of changed) {
        if (isPrefix(['participants', uid], segs)) continue;          // my own row
        if (segs.length === 2 && segs[0] === 'buzzQueue') continue;    // one buzz entry (checked below)
        return deny('permission_denied', `Only the host can change ${segs.join('/') || 'the game'}.`);
    }

    const rowBefore = getAt(before, ['participants', uid]);
    const rowAfter = getAt(after, ['participants', uid]);
    if (!deepEqual(rowBefore, rowAfter)) {
        const v = checkOwnRow(rowBefore, rowAfter, before);
        if (!v.ok) return v;
    }

    const qBefore = getAt(before, ['buzzQueue']) || {};
    const qAfter = getAt(after, ['buzzQueue']) || {};
    for (const key of new Set([...Object.keys(qBefore), ...Object.keys(qAfter)])) {
        const was = qBefore[key] ?? null;
        const now = qAfter[key] ?? null;
        if (deepEqual(was, now)) continue;
        if (was !== null) return deny('permission_denied', 'Only the host can change or clear buzzes.');
        const v = checkBuzz(now, before, qBefore, uid);
        if (!v.ok) return v;
    }
    return { ok: true };
}

function checkOwnRow(before, after, room) {
    if (after === null) return { ok: true };          // leaving the game (or my disconnect cleanup)
    if (!isPlainObject(after)) return deny('bad_value', 'A participant is an object.');
    const lobby = phaseOf(room) === 'lobby';

    // Joining after the lobby means waiting for the host's approval (late join).
    if (before === null && !lobby && after.status !== 'pending') {
        return deny('permission_denied', 'The game has started — ask the host to let you in.');
    }
    for (const [key, value] of Object.entries(after)) {
        const old = before?.[key] ?? null;
        if (deepEqual(value, old)) continue;            // unchanged (incl. fields the host set)
        const allowed = PLAYER_FIELDS[key];
        if (!allowed || !allowed(value)) return deny('permission_denied', `Players can’t set “${key}” like that.`);
        if (key === 'joinedAt' && old !== null) return deny('permission_denied', 'joinedAt never changes.');
        if (key === 'team' && value !== TEAM.NONE && !lobby) return deny('permission_denied', 'Teams are picked in the lobby (or by the host).');
        if (key === 'status' && before?.status === 'active') return deny('permission_denied', 'Already in the game.');
    }
    for (const key of Object.keys(before || {})) {
        if (!(key in after) && !PLAYER_DELETABLE.has(key)) return deny('permission_denied', `Players can’t remove “${key}”.`);
    }
    return { ok: true };
}

function checkBuzz(entry, room, queueBefore, uid) {
    if (!isPlainObject(entry) || entry.uid !== uid || typeof entry.createdAt !== 'number'
        || Object.keys(entry).some(k => k !== 'uid' && k !== 'createdAt')) {
        return deny('bad_buzz', 'A buzz is { uid: you, createdAt: serverTimestamp() }.');
    }
    const q = room.currentQuestion;
    if (!q || q.showAnswer) return deny('no_question', 'There’s no open question to buzz on.');
    const me = room.participants?.[uid];
    if (!me || me.status === 'pending') return deny('permission_denied', 'Only players in the game can buzz.');
    if (me.eligibleFromQuestionId && me.eligibleFromQuestionId === q.id) return deny('not_yet', 'You join from the next question.');
    if (Object.values(queueBefore).some(e => e?.uid === uid)) return deny('duplicate_buzz', 'You already buzzed on this question.');
    return { ok: true };
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** What `uid` may see of the tree. */
export function viewFor(tree, uid) {
    if (tree === null || tree === undefined) return null;
    return roleOf(tree, uid) === 'host' ? tree : redact(tree);
}

/** The player view: no answers (until reveal), no upcoming pictures. */
export function redact(tree) {
    let out = tree;
    if (isPlainObject(tree.board)) {
        const board = {};
        for (const [id, tile] of Object.entries(tree.board)) {
            if (isPlainObject(tile)) {
                // eslint-disable-next-line no-unused-vars
                const { answer, imageUrl, ...visible } = tile;
                board[id] = visible;
            } else {
                board[id] = tile;
            }
        }
        out = { ...out, board };
    }
    const q = tree.currentQuestion;
    if (isPlainObject(q) && q.showAnswer !== true && 'answer' in q) {
        // eslint-disable-next-line no-unused-vars
        const { answer, ...visible } = q;
        out = { ...out, currentQuestion: visible };
    }
    return out;
}

/**
 * Subtrees to re-send after a write. currentQuestion goes whole (whether its
 * answer is visible depends on a sibling); everything else at ≤ 2 levels.
 * @param {string[][]} changed
 * @returns {string[][]}
 */
export function patchRoots(changed) {
    const roots = [];
    for (const segs of changed) {
        const root = segs[0] === 'currentQuestion' ? segs.slice(0, 1) : segs.slice(0, 2);
        if (roots.some(r => isPrefix(r, root))) continue;                 // already covered
        for (let i = roots.length - 1; i >= 0; i--) if (isPrefix(root, roots[i])) roots.splice(i, 1);
        roots.push(root);
    }
    return roots;
}

/** The patch ops a viewer needs: each root's new value in their view. */
export const patchOps = (view, roots) => roots.map(r => ({ p: r.join('/'), v: getAt(view, r) }));

/** Public room info (join screen): does it exist, what phase, am I its host? */
export function roomInfo(tree, uid) {
    return { exists: tree !== null && tree !== undefined, phase: phaseOf(tree), host: !!uid && tree?.hostUid === uid };
}
