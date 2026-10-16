// tests/unit/createFlowAnalytics.test.mjs
//
// Phase 3A — automated tests for Game Creation analytics events.
//
// What can be tested without a browser or full DOM:
//   - pt_game_create_started: fired synchronously from startCreateFlow()
//   - pt_board_selected: fired synchronously before any await in the step-2 handler
//   - pt_game_created: fired after createGameShell() resolves
//   - pt_game_create_abandoned: fired after modal confirm + game removal
//
// Approach: initCreateFlow is called with null UI elements (the on() helper in
// dom.js is null-safe and skips them), but the two buttons that carry analytics
// handlers (step2NextBtn, endGameFromReadyBtn) are lightweight mock objects with
// a real addEventListener so the handlers are registered and callable from tests.
// The capture, boardPicker, confirmDelete, and removeGame services are injected
// as mock functions so the tests run with no network and no DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initCreateFlow } from '../../src/flows/createFlow.js';

// Node.js has no window.alert — silence any error dialogs that appear in catch blocks.
if (typeof global.alert === 'undefined') global.alert = () => {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock button that captures one click handler and lets tests trigger it. */
function makeClickable() {
    let _handler = null;
    return {
        disabled: false,
        dataset: {},
        addEventListener(type, fn) { if (type === 'click') _handler = fn; },
        removeEventListener() {},
        // Returns a Promise that resolves when the full async handler completes.
        click(e = { preventDefault() {} }) { return _handler?.(e) ?? Promise.resolve(); },
    };
}

/** Mock board picker that always reports one board as selected. */
function makeBoardPicker(board = { id: 'brd_test', slug: 'test-board', rev: 3 }) {
    return { getSelected: () => board, reset() {}, load() {} };
}

/**
 * Set up a test harness for initCreateFlow.
 *
 * Options:
 *   onCreateGameShell — async function that replaces createGameShell
 *   confirmDeleteResult — string returned by the mock modal ('confirm' | 'cancel')
 *   removeGameError — if set, doRemoveGame throws this
 */
function setup({
    onCreateGameShell = async () => ({ analyticsId: 'a-id', roundId: 'r-id', boardId: 'test-board', boardRev: 3 }),
    confirmDeleteResult = 'confirm',
    removeGameError = null,
} = {}) {
    const captured = [];
    const doCapture = (event, props) => captured.push({ event, props });

    const step2NextBtn = makeClickable();
    const endGameFromReadyBtn = makeClickable();
    const boardPicker = makeBoardPicker();

    const { startCreateFlow } = initCreateFlow({
        services: {
            requireAuth: async () => 'uid',
            createGameShell: onCreateGameShell,
            renderLobby: async () => {},
            setSession: () => {},
            showView: () => {},
            generateGameId: () => 'LOCALID',
            reserveGameCode: async () => 'GAMECODE',
            // DI hooks
            capture: doCapture,
            boardPicker,
            confirmDelete: async () => confirmDeleteResult,
            removeGame: removeGameError
                ? async () => { throw removeGameError; }
                : async () => {},
        },
        els: {
            // All form/step elements null — on() skips them safely.
            createGameForm: null,
            gmNameInput: null,
            gameNameInput: null,
            teamANameInput: null,
            teamBNameInput: null,
            gmNameRollBtn: null,
            gameNameRollBtn: null,
            teamARollBtn: null,
            teamBRollBtn: null,
            step1Root: null,
            step2Root: null,
            step1NextBtn: null,
            step1ExitBtn: null,
            step2BackBtn: null,
            step2NextBtn,
            setListEl: null,
            headerTitleEl: null,
            readyGameTitle: null,
            readyGameCode: null,
            shareCodeBtn: null,
            goToLobbyBtn: null,
            endGameFromReadyBtn,
        },
    });

    return { startCreateFlow, captured, step2NextBtn, endGameFromReadyBtn };
}

// ---------------------------------------------------------------------------
// 1. pt_game_create_started fires with origin 'new'
// ---------------------------------------------------------------------------
test('pt_game_create_started fires when startCreateFlow("new") is called', () => {
    const { startCreateFlow, captured } = setup();
    startCreateFlow('new');

    const ev = captured.find(e => e.event === 'pt_game_create_started');
    assert.ok(ev, 'pt_game_create_started must be captured');
    assert.equal(ev.props.origin, 'new');
    assert.equal(ev.props.role, 'gm');
});

// ---------------------------------------------------------------------------
// 2. pt_game_create_started fires with origin 'play_again'
// ---------------------------------------------------------------------------
test('pt_game_create_started fires with origin "play_again" when triggered from Play Again', () => {
    const { startCreateFlow, captured } = setup();
    startCreateFlow('play_again');

    const ev = captured.find(e => e.event === 'pt_game_create_started');
    assert.ok(ev, 'pt_game_create_started must be captured');
    assert.equal(ev.props.origin, 'play_again');
});

// ---------------------------------------------------------------------------
// 3. create_attempt_id is a non-empty string
// ---------------------------------------------------------------------------
test('create_attempt_id in pt_game_create_started is a non-empty string', () => {
    const { startCreateFlow, captured } = setup();
    startCreateFlow('new');

    const ev = captured.find(e => e.event === 'pt_game_create_started');
    assert.ok(ev, 'event must be captured');
    assert.equal(typeof ev.props.create_attempt_id, 'string');
    assert.ok(ev.props.create_attempt_id.length > 0, 'create_attempt_id must be non-empty');
});

// ---------------------------------------------------------------------------
// 4. create_attempt_id is fresh on each startCreateFlow() invocation
// ---------------------------------------------------------------------------
test('each startCreateFlow() call produces a distinct create_attempt_id', () => {
    const { startCreateFlow, captured } = setup();
    startCreateFlow('new');
    startCreateFlow('new');

    const ids = captured
        .filter(e => e.event === 'pt_game_create_started')
        .map(e => e.props.create_attempt_id);

    assert.equal(ids.length, 2, 'two invocations → two events');
    assert.notEqual(ids[0], ids[1], 'attempt IDs must differ');
});

// ---------------------------------------------------------------------------
// 5. pt_board_selected fires before async creation steps complete
// ---------------------------------------------------------------------------
test('pt_board_selected fires synchronously before requireAuth / createGameShell await', () => {
    // Create the deferred promise BEFORE setup so resolveShell is bound by the
    // Promise constructor, not by a later factory call.
    let resolveShell;
    const shellPromise = new Promise(r => { resolveShell = r; });

    const { startCreateFlow, captured, step2NextBtn } = setup({
        onCreateGameShell: () => shellPromise,
    });

    startCreateFlow('new');
    // Start the click — do NOT await it yet.
    const clickPromise = step2NextBtn.click();

    // The handler ran synchronously until the first `await requireAuth()`.
    // doCapture('pt_board_selected') fires before that first await.
    const ev = captured.find(e => e.event === 'pt_board_selected');
    assert.ok(ev, 'pt_board_selected must be captured synchronously');
    assert.equal(ev.props.board_id, 'test-board');
    assert.equal(ev.props.board_version, 3);

    // Clean up — let the click resolve so the test doesn't leak an unresolved promise.
    resolveShell({ analyticsId: 'a', roundId: 'r', boardId: 'test-board', boardRev: 3 });
    return clickPromise;
});

// ---------------------------------------------------------------------------
// 6. pt_game_created fires after createGameShell() resolves
// ---------------------------------------------------------------------------
test('pt_game_created fires after successful createGameShell()', async () => {
    const { startCreateFlow, captured, step2NextBtn } = setup();
    startCreateFlow('new');
    await step2NextBtn.click();

    const ev = captured.find(e => e.event === 'pt_game_created');
    assert.ok(ev, 'pt_game_created must be captured');
    assert.equal(ev.props.role, 'gm');
});

// ---------------------------------------------------------------------------
// 7. pt_game_created includes game_session_id and round_id from createGameShell return
// ---------------------------------------------------------------------------
test('pt_game_created carries game_session_id and round_id from createGameShell()', async () => {
    const { startCreateFlow, captured, step2NextBtn } = setup({
        onCreateGameShell: async () => ({
            analyticsId: 'sess-xyz',
            roundId: 'round-abc',
            boardId: 'test-board',
            boardRev: 3,
        }),
    });
    startCreateFlow('new');
    await step2NextBtn.click();

    const ev = captured.find(e => e.event === 'pt_game_created');
    assert.ok(ev);
    assert.equal(ev.props.game_session_id, 'sess-xyz');
    assert.equal(ev.props.round_id, 'round-abc');
});

// ---------------------------------------------------------------------------
// 8. pt_game_created is NOT fired when createGameShell() throws
// ---------------------------------------------------------------------------
test('pt_game_created is not fired when createGameShell() throws', async () => {
    const { startCreateFlow, captured, step2NextBtn } = setup({
        onCreateGameShell: async () => { throw new Error('network error'); },
    });
    startCreateFlow('new');
    await step2NextBtn.click();

    const ev = captured.find(e => e.event === 'pt_game_created');
    assert.equal(ev, undefined, 'pt_game_created must not fire on creation failure');
});

// ---------------------------------------------------------------------------
// 9. pt_game_create_abandoned fires after modal confirm + successful remove
// ---------------------------------------------------------------------------
test('pt_game_create_abandoned fires after Game Ready abandonment with full attempt state', async () => {
    const { startCreateFlow, captured, step2NextBtn, endGameFromReadyBtn } = setup({
        onCreateGameShell: async () => ({
            analyticsId: 'sess-abc',
            roundId: 'round-def',
            boardId: 'test-board',
            boardRev: 3,
        }),
        confirmDeleteResult: 'confirm',
    });

    startCreateFlow('play_again');
    await step2NextBtn.click();     // sets attemptGameMeta + attemptBoardMeta
    await endGameFromReadyBtn.click();

    const ev = captured.find(e => e.event === 'pt_game_create_abandoned');
    assert.ok(ev, 'pt_game_create_abandoned must be captured');
    assert.equal(ev.props.game_session_id, 'sess-abc');
    assert.equal(ev.props.round_id, 'round-def');
    assert.equal(ev.props.board_id, 'test-board');
    assert.equal(ev.props.origin, 'play_again');
    assert.equal(ev.props.role, 'gm');
});

// ---------------------------------------------------------------------------
// 10. pt_game_create_abandoned is NOT fired when modal is dismissed
// ---------------------------------------------------------------------------
test('pt_game_create_abandoned is not fired when End Game modal is dismissed', async () => {
    const { startCreateFlow, captured, endGameFromReadyBtn } = setup({
        confirmDeleteResult: 'cancel',
    });

    startCreateFlow('new');
    await endGameFromReadyBtn.click();

    const ev = captured.find(e => e.event === 'pt_game_create_abandoned');
    assert.equal(ev, undefined, 'pt_game_create_abandoned must not fire when modal is dismissed');
});

// ---------------------------------------------------------------------------
// 11. All 4 events within one attempt share the same create_attempt_id
// ---------------------------------------------------------------------------
test('all 4 analytics events within one attempt share the same create_attempt_id', async () => {
    const { startCreateFlow, captured, step2NextBtn, endGameFromReadyBtn } = setup({
        confirmDeleteResult: 'confirm',
    });

    startCreateFlow('new');
    await step2NextBtn.click();
    await endGameFromReadyBtn.click();

    const eventNames = [
        'pt_game_create_started',
        'pt_board_selected',
        'pt_game_created',
        'pt_game_create_abandoned',
    ];

    const ids = eventNames.map(name => {
        const ev = captured.find(e => e.event === name);
        assert.ok(ev, `${name} must be captured`);
        return ev.props.create_attempt_id;
    });

    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, 1, 'all 4 events must share one create_attempt_id');
    assert.ok([...uniqueIds][0].length > 0, 'the shared ID must be non-empty');
});

// ---------------------------------------------------------------------------
// 12. Rapid double-click: busy guard ensures pt_board_selected fires exactly once
// ---------------------------------------------------------------------------
test('rapid double-click on step2Next fires pt_board_selected exactly once (isBusy guard)', async () => {
    let resolveShell;
    const shellPromise = new Promise(r => { resolveShell = r; });
    const { startCreateFlow, captured, step2NextBtn } = setup({
        onCreateGameShell: () => shellPromise,
    });

    startCreateFlow('new');

    // First click — starts async creation; handler suspends at requireAuth().
    const firstClick = step2NextBtn.click();

    // Second click — isBusy is true; handler exits immediately with no events.
    await step2NextBtn.click();

    // Let the first creation complete.
    resolveShell({ analyticsId: 'a', roundId: 'r', boardId: 'test-board', boardRev: 3 });
    await firstClick;

    const boardSelectedCount = captured.filter(e => e.event === 'pt_board_selected').length;
    const gameCreatedCount = captured.filter(e => e.event === 'pt_game_created').length;

    assert.equal(boardSelectedCount, 1, 'pt_board_selected must fire exactly once');
    assert.equal(gameCreatedCount, 1, 'pt_game_created must fire exactly once');
});
