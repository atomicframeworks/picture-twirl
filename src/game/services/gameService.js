// src/game/services/gameService.js
import { rtdb } from '../../firebase.js';
import { ref, get, set, update, onValue, serverTimestamp } from 'firebase/database';
import * as P from '../../data/paths.js';
import { TEAM, teamToAnswer } from '../../config.js';

/** Get game title once */
export async function getTitle(gameId) {
    const s = await get(ref(rtdb, P.title(gameId)));
    return (s.exists() && String(s.val()).trim()) || 'Picture Twirl Lobby';
}

/** Live title subscription → returns unsubscribe */
export function onTitle(gameId, cb) {
    return onValue(ref(rtdb, P.title(gameId)), s => cb(s.val()));
}

/** Ensure participant row exists for uid */
export async function upsertParticipant(gameId, uid, displayName, isGM) {
    const me = ref(rtdb, P.participant(gameId, uid));
    const snap = await get(me);
    if (!snap.exists()) {
        await set(me, { displayName, team: TEAM.NONE, joinedAt: serverTimestamp(), isGM: !!isGM });
    } else {
        const cur = snap.val() || {};
        await update(me, { displayName, team: cur.team || TEAM.NONE, isGM: !!isGM });
    }
}

/** Post current question + timestamp (host only by rules) */
export async function postCurrentQuestion(gameId, tile) {
    await update(ref(rtdb, P.game(gameId)), {
        currentQuestion: {
            id: tile.id, category: tile.category, imageUrl: tile.imageUrl,
            value: tile.value, showAnswer: false
        },
        swirlStartTime: serverTimestamp()
    });
}

/** Mark tile opened/answered */
export async function markTileOpened(gameId, tileId) {
    await update(ref(rtdb, P.boardTile(gameId, tileId)), {
        opened: true, locked: false, lastActionAt: serverTimestamp()
    });
}
export async function markTileAnswered(gameId, tileId, teamKey, points) {
    await update(ref(rtdb), {
        [P.score(gameId, teamKey)]: (await get(ref(rtdb, P.score(gameId, teamKey)))).val() + points,
        [P.boardTile(gameId, tileId) + '/answered']: true,
        [P.boardTile(gameId, tileId) + '/answeredBy']: teamToAnswer(teamKey),
        [P.boardTile(gameId, tileId) + '/awardedPoints']: points,
        [P.boardTile(gameId, tileId) + '/locked']: false,
        [P.boardTile(gameId, tileId) + '/lastActionAt']: serverTimestamp(),
        [P.currentQuestion(gameId)]: null
    });
}
