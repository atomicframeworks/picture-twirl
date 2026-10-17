// tests/unit/sessionEndedEvent.test.mjs
//
// Regression tests for buildSessionEndedProps (src/game/sessionEndedEvent.js).
//
// Guards the exact shape of the pt_game_session_ended PostHog event so that
// required properties can never be accidentally omitted at the call site.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionEndedProps } from '../../src/game/sessionEndedEvent.js';

// ---------------------------------------------------------------------------
// 1. session_end_reason is always 'gm_ended'
// ---------------------------------------------------------------------------
test('pt_game_session_ended includes session_end_reason: "gm_ended"', () => {
    const props = buildSessionEndedProps('some-id');
    assert.equal(props.session_end_reason, 'gm_ended');
});

// ---------------------------------------------------------------------------
// 2. role is always 'gm'
// ---------------------------------------------------------------------------
test('pt_game_session_ended includes role: "gm"', () => {
    const props = buildSessionEndedProps('some-id');
    assert.equal(props.role, 'gm');
});

// ---------------------------------------------------------------------------
// 3. game_session_id is set from analyticsId when present
// ---------------------------------------------------------------------------
test('pt_game_session_ended carries game_session_id from analyticsId', () => {
    const props = buildSessionEndedProps('abc-123');
    assert.equal(props.game_session_id, 'abc-123');
});

// ---------------------------------------------------------------------------
// 4. game_session_id is undefined (not null) when analyticsId is null,
//    so PostHog omits it rather than sending null
// ---------------------------------------------------------------------------
test('pt_game_session_ended omits game_session_id (undefined) when analyticsId is null', () => {
    const props = buildSessionEndedProps(null);
    assert.equal(props.game_session_id, undefined);
});

// ---------------------------------------------------------------------------
// 5. game_session_id is undefined when analyticsId is undefined
// ---------------------------------------------------------------------------
test('pt_game_session_ended omits game_session_id when analyticsId is undefined', () => {
    const props = buildSessionEndedProps(undefined);
    assert.equal(props.game_session_id, undefined);
});

// ---------------------------------------------------------------------------
// 6. Complete shape: all three required properties present together
// ---------------------------------------------------------------------------
test('pt_game_session_ended has the complete expected shape for a known analyticsId', () => {
    const props = buildSessionEndedProps('session-xyz');
    assert.deepEqual(props, {
        game_session_id: 'session-xyz',
        session_end_reason: 'gm_ended',
        role: 'gm',
    });
});

// ---------------------------------------------------------------------------
// 7. Complete shape when analyticsId is null: game_session_id absent
// ---------------------------------------------------------------------------
test('pt_game_session_ended has the correct shape when analyticsId is null', () => {
    const props = buildSessionEndedProps(null);
    assert.deepEqual(props, {
        game_session_id: undefined,
        session_end_reason: 'gm_ended',
        role: 'gm',
    });
});
