// tests/unit/roomCore.test.mjs — worker/rooms/roomCore.js: who may write what
// in a live game, what each person sees (answers hidden from players), and
// which subtrees are re-sent after a change. The ported + tightened Firebase
// rules (worker/rooms/firebase-rules.legacy.jsonc, AUDIT M7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWrite, patchOps, patchRoots, redact, roleOf, roomInfo, viewFor } from '../../worker/rooms/roomCore.js';

const HOST = 'p_host000000000000';
const AMY = 'p_amy0000000000000';
const BOB = 'p_bob0000000000000';
let clock = 1_000;
const now = () => ++clock;

const write = (tree, uid, ops, extra = {}) => applyWrite(tree, ops, { uid, now, ...extra });

/** A lobby with the host and Amy (no team yet). */
function lobby() {
    const res = write(null, HOST, [{ p: '', v: {
        hostUid: HOST, title: 'Test', state: { phase: 'lobby' }, scores: { A: 0, B: 0 },
        board: { '0-0': { id: '0-0', answer: 'Bagel', imageUrl: '/media/display/x.webp', value: 100, opened: false } },
        participants: { [HOST]: { displayName: 'GM', team: 'none', joinedAt: { '.sv': 'timestamp' }, isGM: true } },
    } }]);
    assert.ok(res.ok, res.message);
    const withAmy = write(res.tree, AMY, [{ p: `participants/${AMY}`, v: { displayName: 'Amy', team: 'none', joinedAt: { '.sv': 'timestamp' }, isGM: false } }]);
    assert.ok(withAmy.ok, withAmy.message);
    return withAmy.tree;
}

/** The same game, live, with a question open. */
function liveWithQuestion() {
    let t = lobby();
    t = write(t, AMY, [{ p: `participants/${AMY}/team`, v: 'A' }]).tree;
    t = write(t, HOST, [
        { p: 'state/phase', v: 'live' },
        { p: 'currentQuestion', v: { id: '0-0', answer: 'Bagel', imageUrl: '/media/display/x.webp', value: 100, showAnswer: false } },
    ]).tree;
    return t;
}

test('create: only into an empty room, only as its host, honoring a reserved code', () => {
    assert.equal(write(null, AMY, [{ p: '', v: { hostUid: HOST } }]).code, 'permission_denied');
    assert.equal(write(null, AMY, [{ p: `participants/${AMY}`, v: { displayName: 'Amy' } }]).code, 'permission_denied'); // no ghost rows in a deleted game (AUDIT M3)
    assert.equal(write(null, HOST, [{ p: '', v: { hostUid: HOST } }], { claimedBy: AMY }).code, 'code_taken');
    assert.ok(write(null, HOST, [{ p: '', v: { hostUid: HOST } }], { claimedBy: HOST }).ok);
    assert.equal(roleOf(lobby(), HOST), 'host');
    assert.equal(roleOf(lobby(), AMY), 'player');
    assert.equal(roleOf(lobby(), null), 'guest');
});

test('host: may change anything and delete the game, but not give it away', () => {
    const t = lobby();
    assert.ok(write(t, HOST, [{ p: `participants/${AMY}/team`, v: 'B' }, { p: 'scores/A', v: 300 }]).ok);
    assert.ok(write(t, HOST, [{ p: '', v: null }]).ok);
    assert.equal(write(t, HOST, [{ p: 'hostUid', v: AMY }]).code, 'permission_denied');
});

test('players: own row only — no other rows, no game state', () => {
    const t = lobby();
    assert.ok(write(t, AMY, [{ p: `participants/${AMY}/team`, v: 'A' }]).ok);
    assert.equal(write(t, AMY, [{ p: `participants/${HOST}/team`, v: 'A' }]).code, 'permission_denied');
    assert.equal(write(t, AMY, [{ p: 'scores/A', v: 999 }]).code, 'permission_denied');
    assert.equal(write(t, AMY, [{ p: 'state/phase', v: 'live' }]).code, 'permission_denied');
    assert.equal(write(t, AMY, [{ p: 'participants', v: null }]).code, 'permission_denied');
    assert.ok(write(t, AMY, [{ p: `participants/${AMY}`, v: null }]).ok);       // leaving is fine
});

test('players: whitelisted fields and values (no isGM, no points, no self-approval)', () => {
    const t = lobby();
    const me = (field, v) => write(t, AMY, [{ p: `participants/${AMY}/${field}`, v }]);
    assert.ok(me('online', true).ok && me('lastSeen', { '.sv': 'timestamp' }).ok);
    assert.ok(me('playAgainVote', 'yes').ok && me('tileRequest', { id: '0-0', category: 'Food', value: 100 }).ok);
    assert.equal(me('isGM', true).code, 'permission_denied');
    assert.equal(me('pointsEarned', 500).code, 'permission_denied');
    assert.equal(me('status', 'active').code, 'permission_denied');
    assert.equal(me('team', 'C').code, 'permission_denied');
    assert.equal(me('displayName', 'x'.repeat(41)).code, 'permission_denied');
    assert.equal(me('joinedAt', 5).code, 'permission_denied');                    // immutable once set
    assert.equal(me('tileRequest', { id: '0-0', answer: 'peek' }).code, 'permission_denied');
    assert.equal(me('displayName', null).code, 'permission_denied');              // can't drop required fields
});

test('players: teams only in the lobby; late joiners must wait for the host', () => {
    const t = liveWithQuestion();
    assert.equal(write(t, AMY, [{ p: `participants/${AMY}/team`, v: 'B' }]).code, 'permission_denied');
    assert.equal(write(t, BOB, [{ p: `participants/${BOB}`, v: { displayName: 'Bob', team: 'none', isGM: false } }]).code, 'permission_denied');
    const pending = write(t, BOB, [{ p: `participants/${BOB}`, v: { displayName: 'Bob', team: 'none', isGM: false, status: 'pending', joinedAt: { '.sv': 'timestamp' } } }]);
    assert.ok(pending.ok, pending.message);
    // The host approves; afterwards Bob can't drop or reset his status himself.
    const approved = write(pending.tree, HOST, [{ p: `participants/${BOB}/status`, v: 'active' }, { p: `participants/${BOB}/team`, v: 'B' }]).tree;
    assert.equal(write(approved, BOB, [{ p: `participants/${BOB}/status`, v: 'pending' }]).code, 'permission_denied');
    assert.equal(write(approved, BOB, [{ p: `participants/${BOB}/status`, v: null }]).code, 'permission_denied');
});

test('buzzes: one per player, only on an open question, created right, cleared only by the host', () => {
    const t = liveWithQuestion();
    const buzz = (tree, uid, key, v = { uid, createdAt: { '.sv': 'timestamp' } }) => write(tree, uid, [{ p: `buzzQueue/${key}`, v }]);
    const first = buzz(t, AMY, 'k1');
    assert.ok(first.ok, first.message);
    assert.equal(buzz(first.tree, AMY, 'k2').code, 'duplicate_buzz');
    assert.equal(buzz(t, AMY, 'k3', { uid: HOST, createdAt: 1 }).code, 'bad_buzz');           // can't buzz as someone else
    assert.equal(buzz(t, AMY, 'k4', { uid: AMY, createdAt: 1, extra: 1 }).code, 'bad_buzz');
    assert.equal(buzz(lobby(), AMY, 'k5').code, 'no_question');
    assert.equal(write(first.tree, AMY, [{ p: 'buzzQueue/k1', v: null }]).code, 'permission_denied');
    assert.ok(write(first.tree, HOST, [{ p: 'buzzQueue', v: null }]).ok);
    const revealed = write(t, HOST, [{ p: 'currentQuestion/showAnswer', v: true }]).tree;
    assert.equal(buzz(revealed, AMY, 'k6').code, 'no_question');
    const deferred = write(t, HOST, [{ p: `participants/${AMY}/eligibleFromQuestionId`, v: '0-0' }]).tree;
    assert.equal(buzz(deferred, AMY, 'k7').code, 'not_yet');
});

test('buzz order: the room clock is strictly increasing, so order = arrival order', () => {
    const t = write(liveWithQuestion(), HOST, [{ p: `participants/${BOB}`, v: { displayName: 'Bob', team: 'B' } }]).tree;
    const a = write(t, AMY, [{ p: 'buzzQueue/z', v: { uid: AMY, createdAt: { '.sv': 'timestamp' } } }]);
    const b = write(a.tree, BOB, [{ p: 'buzzQueue/a', v: { uid: BOB, createdAt: { '.sv': 'timestamp' } } }]);
    assert.ok(b.tree.buzzQueue.z.createdAt < b.tree.buzzQueue.a.createdAt);
});

test('views: players never see answers or upcoming pictures until the reveal (AUDIT M7)', () => {
    const t = liveWithQuestion();
    const player = viewFor(t, AMY);
    assert.equal(player.board['0-0'].answer, undefined);
    assert.equal(player.board['0-0'].imageUrl, undefined);
    assert.equal(player.board['0-0'].value, 100);
    assert.equal(player.currentQuestion.answer, undefined);
    assert.equal(player.currentQuestion.imageUrl, '/media/display/x.webp');      // the open question's picture is shown
    assert.equal(viewFor(t, HOST).currentQuestion.answer, 'Bagel');
    assert.equal(viewFor(t, null).board['0-0'].answer, undefined);
    const revealed = write(t, HOST, [{ p: 'currentQuestion/showAnswer', v: true }]).tree;
    assert.equal(viewFor(revealed, AMY).currentQuestion.answer, 'Bagel');
    assert.equal(viewFor(revealed, AMY).board['0-0'].answer, undefined);
    redact(t);
    assert.equal(t.board['0-0'].answer, 'Bagel');                                 // redacting never touches the room's copy
    assert.equal(viewFor(null, AMY), null);
});

test('patches: currentQuestion re-sent whole (reveal adds the answer), others at ≤ 2 levels', () => {
    assert.deepEqual(patchRoots([['currentQuestion', 'showAnswer']]), [['currentQuestion']]);
    assert.deepEqual(patchRoots([['board', '0-0', 'opened'], ['board', '0-0', 'lastActionAt']]), [['board', '0-0']]);
    assert.deepEqual(patchRoots([['participants', AMY, 'team'], ['participants']]), [['participants']]);
    assert.deepEqual(patchRoots([['scores', 'A'], ['scores', 'B']]), [['scores', 'A'], ['scores', 'B']]);
    assert.deepEqual(patchRoots([[]]), [[]]);
    const t = liveWithQuestion();
    const revealed = write(t, HOST, [{ p: 'currentQuestion/showAnswer', v: true }]);
    const ops = patchOps(viewFor(revealed.tree, AMY), patchRoots(revealed.changed));
    assert.deepEqual(ops, [{ p: 'currentQuestion', v: { id: '0-0', answer: 'Bagel', imageUrl: '/media/display/x.webp', value: 100, showAnswer: true } }]);
});

test('limits and shapes: bad paths, oversized player writes, empty writes', () => {
    const t = lobby();
    assert.equal(write(t, AMY, [{ p: 'participants/a.b', v: 1 }]).code, 'bad_path');
    assert.equal(write(t, AMY, []).code, 'bad_write');
    assert.equal(write(t, AMY, [{ v: 1 }]).code, 'bad_write');
    assert.equal(write(t, AMY, [{ p: `participants/${AMY}/displayName`, v: 'x'.repeat(5000) }]).code, 'too_large');
    assert.equal(applyWrite(t, [{ p: 'x', v: 1 }], { uid: null, now }).code, 'signed_out');
    assert.ok(write(t, AMY, [{ p: `participants/${AMY}/online`, v: true }]).ok);
    assert.equal(write(write(t, AMY, [{ p: `participants/${AMY}/online`, v: true }]).tree, AMY, [{ p: `participants/${AMY}/online`, v: true }]).noop, true);
});

test('roomInfo: exists / phase / am I the host', () => {
    assert.deepEqual(roomInfo(null, AMY), { exists: false, phase: null, host: false });
    assert.deepEqual(roomInfo(lobby(), HOST), { exists: true, phase: 'lobby', host: true });
    assert.deepEqual(roomInfo(lobby(), null), { exists: true, phase: 'lobby', host: false });
});
