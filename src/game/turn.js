// src/game/turn.js
//
// Picture Twirl — Team turn management
// -----------------------------------------------------------------------------
// currentTurn is team-based: { team: 'A'|'B' }. No player uid stored here —
// the GM picks tiles on behalf of whatever team is up.
// -----------------------------------------------------------------------------

import { rtdb } from '../firebase.js';
import { ref, get, update } from 'firebase/database';
import * as P from '../data/paths.js';
import { TEAM } from '../config.js';

/**
 * Randomly pick a starting team and write { team } to /currentTurn.
 * No-op if a turn already exists.
 */
export async function initializeStartingTurn(gameId) {
    const snap = await get(ref(rtdb, `${P.game(gameId)}/currentTurn`));
    if (snap.exists()) return;

    const firstTeam = Math.random() < 0.5 ? TEAM.A : TEAM.B;
    await update(ref(rtdb, P.game(gameId)), {
        currentTurn: { team: firstTeam }
    });
}

/**
 * Move to the next team's turn after a round ends.
 * @param {string} gameId
 * @param {string|null} awardedTeam - The team key that just scored, or null if
 *   neither team was awarded (GM hit Back to Board). When null the turn flips to
 *   the team that did NOT just pick.
 */
export async function advanceTurn(gameId, awardedTeam) {
    const snap = await get(ref(rtdb, `${P.game(gameId)}/currentTurn`));
    const currentTeam = snap.val()?.team || TEAM.A;

    // Winner picks next; no winner → other team picks next.
    const nextTeam = awardedTeam ?? (currentTeam === TEAM.A ? TEAM.B : TEAM.A);

    await update(ref(rtdb, P.game(gameId)), {
        currentTurn: { team: nextTeam }
    });
}
