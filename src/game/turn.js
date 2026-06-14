// src/game/turn.js
//
// Picture Twirl — Turn selection
// -----------------------------------------------------------------------------
// "Whose turn is it" is display-only state at /games/{id}/currentTurn. The GM
// seeds it once at game start. Extracted from renderGame.js so the controller
// doesn't carry this one-shot setup logic inline.
// -----------------------------------------------------------------------------

import { rtdb } from '../firebase.js';
import { ref, get, update } from 'firebase/database';
import * as P from '../data/paths.js';
import { TEAM } from '../config.js';

/**
 * Pick a random starting player from whichever teams have members, and write it
 * to /currentTurn. No-op if a turn already exists or no team has players.
 * Intended to be called once by the GM at game start.
 * @param {string} gameId
 */
export async function initializeStartingTurn(gameId) {
    const turnSnap = await get(ref(rtdb, `${P.game(gameId)}/currentTurn`));
    if (turnSnap.exists()) return;

    const parts = (await get(ref(rtdb, P.participants(gameId)))).val() || {};

    const teamAPlayers = [], teamBPlayers = [];
    for (const [uid, p] of Object.entries(parts)) {
        if (p.team === TEAM.A) teamAPlayers.push(uid);
        else if (p.team === TEAM.B) teamBPlayers.push(uid);
    }

    const pools = [];
    if (teamAPlayers.length) pools.push({ team: TEAM.A, players: teamAPlayers });
    if (teamBPlayers.length) pools.push({ team: TEAM.B, players: teamBPlayers });
    if (pools.length === 0) return;

    const pick = pools[Math.floor(Math.random() * pools.length)];
    const uidPick = pick.players[Math.floor(Math.random() * pick.players.length)];

    await update(ref(rtdb, P.game(gameId)), {
        currentTurn: { uid: uidPick, team: pick.team }
    });
}
