import { rtdb, getCurrentUser } from '../firebase.js';
import { ref, get, set, update, serverTimestamp } from 'firebase/database';
import { getSession } from '../session.js';
import { TEAM } from '../config.js';
import * as P from '../data/paths.js';

/**
 * Assign the current user to a team ('a' or 'b')
 * Stores user data in RTDB under `/games/{gameId}/participants/{uid}`
 */
export async function assignToTeam(gameId) {
    const user = getCurrentUser();
    if (!user) throw new Error('User not authenticated');

    const { displayName, isGM } = getSession();

    // Read current participants to balance sizes
    const partsRef = ref(rtdb, P.participants(gameId));
    const snap = await get(partsRef);
    const parts = snap.exists() ? snap.val() : {};

    let a = 0, b = 0;
    Object.values(parts).forEach(p => { if (p.team === TEAM.A) a++; else if (p.team === TEAM.B) b++; });
    const assignedTeam = a <= b ? TEAM.A : TEAM.B;

    const meRef = ref(rtdb, P.participant(gameId, user.uid));
    await set(meRef, {
        displayName: displayName || `Player-${user.uid.slice(-4)}`,
        team: assignedTeam,
        joinedAt: serverTimestamp(),
        // lastBuzzAt is added later on first buzz by the client per rules
    });

    console.log(`Assigned to team ${assignedTeam}`);
}

export async function setUserTeam(gameId, teamKey /* TEAM.A|TEAM.B|TEAM.NONE */) {
    const user = getCurrentUser();
    if (!user) throw new Error('User not authenticated');
    await update(ref(rtdb, P.participant(gameId, user.uid)), { team: teamKey });
}
