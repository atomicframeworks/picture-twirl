// src/game/sessionEndedEvent.js
//
// Pure helper for building the pt_game_session_ended event properties.
// Kept separate so the exact property set can be unit-tested without
// pulling in the DOM or the RTDB client.

/**
 * Build the property bag for the pt_game_session_ended PostHog event.
 *
 * @param {string|null} analyticsId  - the game's analyticsId (null → property omitted)
 * @returns {{ game_session_id?: string, session_end_reason: string, role: string }}
 */
export function buildSessionEndedProps(analyticsId) {
    return {
        game_session_id: analyticsId ?? undefined,
        session_end_reason: 'gm_ended',
        role: 'gm',
    };
}
