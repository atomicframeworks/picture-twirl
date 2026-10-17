// tests/unit/gameLifecycleAnalytics.test.mjs
//
// Phase 3B — automated tests for gameplay lifecycle analytics events.
//
// Scope: pt_game_joined — fully testable via DI in initJoinFlow.
//
// Approach: initJoinFlow accepts capture and getGameAnalyticsContext as
// injectable services (DI pattern from Phase 3A). Tests call confirmJoin.click()
// directly and assert which events were captured.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initJoinFlow } from '../../src/flows/joinFlow.js';

if (typeof global.alert === 'undefined') global.alert = () => {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mock clickable button (same pattern as Phase 3A). */
function makeClickable() {
    let _handler = null;
    return {
        disabled: false,
        dataset: {},
        addEventListener(type, fn) { if (type === 'click') _handler = fn; },
        removeEventListener() {},
        click(e = { preventDefault() {} }) { return _handler?.(e) ?? Promise.resolve(); },
    };
}

/** Mock input element with a value (null-safe for on() helper). */
function makeInput(value = '') {
    return {
        value,
        classList: { add() {}, remove() {} },
        addEventListener() {},
        removeEventListener() {},
    };
}

/** Mock error row (setAttribute/removeAttribute interface). */
function makeErrorRow() {
    return {
        setAttribute() {},
        removeAttribute() {},
        hidden: false,
        addEventListener() {},
        removeEventListener() {},
    };
}

/**
 * Set up a test harness for initJoinFlow.
 *
 * Options:
 *   gameCode       — prefilled game ID input value
 *   playerName     — prefilled player name input value
 *   roomInfo       — what getRoomInfo returns
 *   getGameAnalyticsContext — injectable context fetcher
 */
function setup({
    gameCode = 'abc123',
    playerName = 'TestPlayer',
    roomInfo = { exists: true, phase: 'lobby', host: false },
    getGameAnalyticsContext = async () => ({ analyticsId: 'a-id', roundId: 'r-id' }),
} = {}) {
    const captured = [];
    const doCapture = (event, props) => captured.push({ event, props });

    const confirmJoin = makeClickable();
    const joinGameIdInput = makeInput(gameCode);
    const playerNameInput = makeInput(playerName);

    const { startJoinFlow } = initJoinFlow({
        services: {
            requireAuth: async () => 'uid',
            gameExists: async () => roomInfo.exists,
            getGamePhase: async () => roomInfo.phase,
            getRoomInfo: async () => roomInfo,
            renderLobby: async () => {},
            renderLateJoin: async () => {},
            setSession: () => {},
            showView: () => {},
            capture: doCapture,
            getGameAnalyticsContext,
        },
        els: {
            joinForm: null,
            confirmJoin,
            cancelJoinBtn: null,
            joinGameIdInput,
            playerNameInput,
            playerNameRollBtn: null,
            joinErrorRow: makeErrorRow(),
            joinErrorText: makeInput(''),
        },
    });

    return { startJoinFlow, captured, confirmJoin, joinGameIdInput, playerNameInput };
}

// ---------------------------------------------------------------------------
// 1. pt_game_joined fires for a lobby join (phase: lobby)
// ---------------------------------------------------------------------------
test('pt_game_joined fires when a player joins in the lobby phase', async () => {
    const { captured, confirmJoin } = setup({ roomInfo: { exists: true, phase: 'lobby', host: false } });
    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.ok(ev, 'pt_game_joined must be captured');
    assert.equal(ev.props.role, 'player');
});

// ---------------------------------------------------------------------------
// 2. pt_game_joined fires for a late join (phase: live)
// ---------------------------------------------------------------------------
test('pt_game_joined fires when a player joins an in-progress game (phase: live)', async () => {
    const { captured, confirmJoin } = setup({ roomInfo: { exists: true, phase: 'live', host: false } });
    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.ok(ev, 'pt_game_joined must be captured for late join');
    assert.equal(ev.props.role, 'player');
});

// ---------------------------------------------------------------------------
// 3. pt_game_joined does NOT fire when the game does not exist
// ---------------------------------------------------------------------------
test('pt_game_joined does NOT fire when the game does not exist', async () => {
    const { captured, confirmJoin } = setup({ roomInfo: { exists: false, phase: null, host: false } });
    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.equal(ev, undefined, 'pt_game_joined must not fire for a non-existent game');
});

// ---------------------------------------------------------------------------
// 4. pt_game_joined does NOT fire for the host reconnect path
// ---------------------------------------------------------------------------
test('pt_game_joined does NOT fire when the host rejoins by code (isGM reconnect)', async () => {
    const { captured, confirmJoin } = setup({ roomInfo: { exists: true, phase: 'lobby', host: true } });
    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.equal(ev, undefined, 'pt_game_joined must not fire for GM reconnect path');
});

// ---------------------------------------------------------------------------
// 5. pt_game_joined does NOT fire when the game has ended
// ---------------------------------------------------------------------------
test('pt_game_joined does NOT fire when the game phase is "ended"', async () => {
    const { captured, confirmJoin } = setup({ roomInfo: { exists: true, phase: 'ended', host: false } });
    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.equal(ev, undefined, 'pt_game_joined must not fire for an ended game');
});

// ---------------------------------------------------------------------------
// 6. pt_game_joined does NOT fire when the session has ended
// ---------------------------------------------------------------------------
test('pt_game_joined does NOT fire when the game phase is "sessionEnded"', async () => {
    const { captured, confirmJoin } = setup({ roomInfo: { exists: true, phase: 'sessionEnded', host: false } });
    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.equal(ev, undefined, 'pt_game_joined must not fire for a sessionEnded game');
});

// ---------------------------------------------------------------------------
// 7. pt_game_joined carries game_session_id from getGameAnalyticsContext
// ---------------------------------------------------------------------------
test('pt_game_joined carries game_session_id from getGameAnalyticsContext', async () => {
    const { captured, confirmJoin } = setup({
        getGameAnalyticsContext: async () => ({ analyticsId: 'session-xyz', roundId: 'round-abc' }),
    });
    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.ok(ev, 'pt_game_joined must be captured');
    assert.equal(ev.props.game_session_id, 'session-xyz');
});

// ---------------------------------------------------------------------------
// 8. pt_game_joined carries round_id from getGameAnalyticsContext
// ---------------------------------------------------------------------------
test('pt_game_joined carries round_id from getGameAnalyticsContext', async () => {
    const { captured, confirmJoin } = setup({
        getGameAnalyticsContext: async () => ({ analyticsId: 'session-xyz', roundId: 'round-abc' }),
    });
    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.ok(ev);
    assert.equal(ev.props.round_id, 'round-abc');
});

// ---------------------------------------------------------------------------
// 9. pt_game_joined fires even when getGameAnalyticsContext throws
// ---------------------------------------------------------------------------
test('pt_game_joined fires even when getGameAnalyticsContext throws (analytics never blocks gameplay)', async () => {
    const { captured, confirmJoin } = setup({
        getGameAnalyticsContext: async () => { throw new Error('network error'); },
    });
    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.ok(ev, 'pt_game_joined must fire despite context fetch failure');
    assert.equal(ev.props.role, 'player');
});

// ---------------------------------------------------------------------------
// 10. pt_game_joined fires when getGameAnalyticsContext is null (not injected)
// ---------------------------------------------------------------------------
test('pt_game_joined fires gracefully when getGameAnalyticsContext is not provided', async () => {
    const captured = [];
    const doCapture = (event, props) => captured.push({ event, props });
    const confirmJoin = makeClickable();

    initJoinFlow({
        services: {
            requireAuth: async () => 'uid',
            gameExists: async () => true,
            getGamePhase: async () => 'lobby',
            getRoomInfo: async () => ({ exists: true, phase: 'lobby', host: false }),
            renderLobby: async () => {},
            renderLateJoin: async () => {},
            setSession: () => {},
            showView: () => {},
            capture: doCapture,
            // getGameAnalyticsContext deliberately omitted
        },
        els: {
            joinForm: null,
            confirmJoin,
            cancelJoinBtn: null,
            joinGameIdInput: makeInput('abc123'),
            playerNameInput: makeInput('TestPlayer'),
            playerNameRollBtn: null,
            joinErrorRow: makeErrorRow(),
            joinErrorText: makeInput(''),
        },
    });

    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.ok(ev, 'pt_game_joined must fire without getGameAnalyticsContext');
    assert.equal(ev.props.role, 'player');
});

// ---------------------------------------------------------------------------
// 11. pt_game_joined phase property is 'lobby' for lobby join
// ---------------------------------------------------------------------------
test('pt_game_joined has phase "lobby" for a lobby join', async () => {
    const { captured, confirmJoin } = setup({ roomInfo: { exists: true, phase: 'lobby', host: false } });
    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.ok(ev);
    assert.equal(ev.props.phase, 'lobby');
});

// ---------------------------------------------------------------------------
// 12. pt_game_joined phase property is 'live' for late join
// ---------------------------------------------------------------------------
test('pt_game_joined has phase "live" for a late join', async () => {
    const { captured, confirmJoin } = setup({ roomInfo: { exists: true, phase: 'live', host: false } });
    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.ok(ev);
    assert.equal(ev.props.phase, 'live');
});

// ---------------------------------------------------------------------------
// 13. pt_game_joined game_session_id is undefined when context returns null analyticsId
// ---------------------------------------------------------------------------
test('pt_game_joined omits game_session_id when analyticsId is null', async () => {
    const { captured, confirmJoin } = setup({
        getGameAnalyticsContext: async () => ({ analyticsId: null, roundId: null }),
    });
    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.ok(ev);
    assert.equal(ev.props.game_session_id, undefined);
    assert.equal(ev.props.round_id, undefined);
});

// ---------------------------------------------------------------------------
// 14. pt_game_joined fires exactly once per join attempt
// ---------------------------------------------------------------------------
test('pt_game_joined fires exactly once for a single join', async () => {
    const { captured, confirmJoin } = setup();
    await confirmJoin.click();

    const count = captured.filter(e => e.event === 'pt_game_joined').length;
    assert.equal(count, 1, 'pt_game_joined must fire exactly once');
});

// ---------------------------------------------------------------------------
// 15. pt_game_joined does NOT fire when player name is empty (form invalid)
// ---------------------------------------------------------------------------
test('pt_game_joined does NOT fire when the player name field is empty', async () => {
    const { captured, confirmJoin } = setup({ playerName: '' });
    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.equal(ev, undefined, 'pt_game_joined must not fire when form is invalid');
});

// ---------------------------------------------------------------------------
// 16. pt_game_joined does NOT fire when game code is empty (form invalid)
// ---------------------------------------------------------------------------
test('pt_game_joined does NOT fire when the game code field is empty', async () => {
    const { captured, confirmJoin } = setup({ gameCode: '' });
    await confirmJoin.click();

    const ev = captured.find(e => e.event === 'pt_game_joined');
    assert.equal(ev, undefined, 'pt_game_joined must not fire when game code is missing');
});
