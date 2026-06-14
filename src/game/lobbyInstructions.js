// src/game/lobbyInstructions.js
//
// Picture Twirl — Lobby instruction-line state machine
// -----------------------------------------------------------------------------
// The lobby's single instruction line ("Tap player to assign…", "✅ Joined Red
// team", etc.) used to be decided in three places (the participants observer
// plus showPlayerActions/clearPlayerActions) coordinated by loose flags
// (lastAssignedTeam, playerJoinTimeout, lastPlayerTeam). This module owns all of
// that: the text decisions, the transient "success" messages, and their timers.
//
// It is DOM-free — the caller injects `setText(message, isSuccess)` (which
// writes to the .lobby-instruction element) and `getParts()` (latest
// participants snapshot, for the deferred recompute after a success message).
//
//   const instr = createInstructionController({ isGM, teamNames, setText, getParts });
//   instr.editing()                                   // GM started editing a player
//   instr.assigned(team)                              // GM assigned the selected player
//   instr.sync({ counts, parts, myTeam, editing })    // participants snapshot changed
//   instr.dispose()                                   // clear any pending timer
// -----------------------------------------------------------------------------

import { TEAM } from '../config.js';

const SUCCESS_MS = 3000;

/**
 * @param {object} opts
 * @param {boolean} opts.isGM
 * @param {{ A: string, B: string }} opts.teamNames  Live reference; read at call time.
 * @param {(message: string, isSuccess?: boolean) => void} opts.setText
 * @param {() => Record<string, any>} opts.getParts   Latest participants snapshot.
 */
export function createInstructionController({ isGM, teamNames, setText, getParts }) {
    let timer = null;
    let showingAssignSuccess = false;  // GM: suppress observer default while success shows
    let lastPlayerTeam = null;         // player: detect "just joined a team"

    const nameOf = (team) => (team === TEAM.A ? teamNames.A : teamNames.B);
    const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

    // GM's default line, derived from the latest participants snapshot.
    function gmDefault(parts) {
        const keys = Object.keys(parts || {});
        const unassigned = keys.filter((k) => (parts[k]?.team || TEAM.NONE) === TEAM.NONE).length;
        if (unassigned === 0 && keys.length > 0) {
            setText('Yay! All players assigned to teams.', true);
        } else {
            setText('Tap player to assign to a team.');
        }
    }

    return {
        /** GM clicked a player pill to edit them. */
        editing() {
            setText('Move player to a team using the buttons.');
        },

        /** GM assigned the selected player to `team`; show success, then revert. */
        assigned(team) {
            showingAssignSuccess = true;
            setText(`✅ Assigned player to ${nameOf(team)} team.`, true);
            clearTimer();
            timer = setTimeout(() => {
                timer = null;
                showingAssignSuccess = false;
                gmDefault(getParts());
            }, SUCCESS_MS);
        },

        /**
         * React to a participants snapshot.
         * @param {{ counts: {none:number}, parts: object, myTeam: string, editing: boolean }} s
         */
        sync({ parts, myTeam, editing }) {
            if (editing) return;            // instruction owned by editing()
            if (isGM) {
                if (showingAssignSuccess) return;  // don't clobber the success message
                gmDefault(parts);
                return;
            }
            // Player
            if (myTeam === TEAM.NONE) {
                setText('Pick a team to join');
                clearTimer();
                lastPlayerTeam = null;
                return;
            }
            const justJoined = lastPlayerTeam !== myTeam;
            lastPlayerTeam = myTeam;
            if (justJoined) {
                clearTimer();
                setText(`✅ Joined ${nameOf(myTeam)} team`, true);
                timer = setTimeout(() => {
                    timer = null;
                    setText(`You're on ${nameOf(myTeam)} team`);
                }, SUCCESS_MS);
            }
        },

        /** Clear any pending success-message timer (call on teardown). */
        dispose() { clearTimer(); },
    };
}
