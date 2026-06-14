// src/game/lobby.js
//
// Lobby Controller — Host-only End, accurate "Editing: NAME", host can't leave,
// single-row tray mode, hide Join Random when already on a team.
// -----------------------------------------------------------------------------

import { rtdb, getCurrentUser } from '../firebase.js';
import { ref, onValue, update, get, remove } from 'firebase/database';
import * as P from '../data/paths.js';
import { getSession } from '../session.js';
import { renderGameUI } from './renderGame.js';
import { on as listen } from '../ui/dom.js';
import { attachCopyButton } from '../ui/copyButton.js';
import { mountTemplate, collectRefs } from '../ui/templates.js';
import { modal } from '../ui/modal.js';
import { createDisposer, exitToHome, leaveGame, confirmEndGame, endGame } from './controllerKit.js';
import { ensureParticipant, attachPresence, setTeam } from './participants.js';
import { TEAM } from '../config.js';


export async function renderLobby(gameId) {
    await ensureParticipant(gameId);

    // Update URL with game code for easy sharing
    window.history.replaceState(null, '', `#${gameId.toUpperCase()}`);

    const uid = getCurrentUser()?.uid || null;
    const { isGM } = getSession();

    const app = document.getElementById('app');
    const root = mountTemplate(app, 'tpl-lobby');
    const refs = collectRefs(root);

    refs.codeEl.textContent = gameId.toUpperCase();
    root.classList.toggle('is-gm', !!isGM);

    const { track, disposeAll } = createDisposer();

    // Copy code button handler
    track(attachCopyButton(refs.copyCodeBtn, () => gameId.toUpperCase()));

    // Keep main scroll clear of tray
    function syncTrayHeight() {
        const h = refs.trayEl ? refs.trayEl.offsetHeight : 0;
        root.style.setProperty('--tray-h', `${Math.max(h, 120)}px`);
    }
    syncTrayHeight();
    if ('ResizeObserver' in window && refs.trayEl) {
        const ro = new ResizeObserver(syncTrayHeight);
        ro.observe(refs.trayEl);
        track(() => ro.disconnect());
    }
    window.addEventListener('resize', syncTrayHeight);
    window.addEventListener('orientationchange', syncTrayHeight);
    track(() => {
        window.removeEventListener('resize', syncTrayHeight);
        window.removeEventListener('orientationchange', syncTrayHeight);
    });

    if (uid) track(attachPresence(gameId, uid));

    // Title
    track(onValue(ref(rtdb, P.title(gameId)), (s) => {
        const name = (s.val() || 'Picture Twirl').toString().trim();
        refs.titleEl.textContent = name;
        document.title = `${name} — Picture Twirl`;
    }));

    // Settings
    let teamsEnabled = true;
    track(onValue(ref(rtdb, P.settings(gameId)), (s) => {
        const v = s.val() || {}; teamsEnabled = v.teamsEnabled !== false;
    }));

    // Team names
    let teamNames = { A: 'Team A', B: 'Team B' };
    track(onValue(ref(rtdb, P.teams(gameId)), (s) => {
        const t = s.val() || {};
        if (t?.A?.name) teamNames.A = t.A.name;
        if (t?.B?.name) teamNames.B = t.B.name;
        refs.teamAName.textContent = teamNames.A;
        refs.teamBName.textContent = teamNames.B;
        if (refs.assignA) refs.assignA.textContent = `Move to ${teamNames.A}`;
        if (refs.assignB) refs.assignB.textContent = `Move to ${teamNames.B}`;
    }));

    // ---------- Tray mode control: exactly ONE visible row ----------
    // mode = 'gm'|'player'|'user'
    function setTrayMode(mode) {
        const show = (el, v) => { if (el) el.hidden = !v; };
        show(refs.gmActions, mode === 'gm');
        show(refs.hostActions, mode === 'player');
        show(refs.mainActions, mode === 'user');
        syncTrayHeight();
    }

    // If GM, move Join Random into GM row so we can hide mainActions entirely
    if (isGM) {
        if (refs.joinRandom && refs.gmActions) {
            refs.gmActions.prepend(refs.joinRandom); // GM sees Join Random with Start/End
        }
        // Host cannot leave game
        if (refs.exitGameBtn) { refs.exitGameBtn.style.display = 'none'; }
        // Show GM row by default
        setTrayMode('gm');
    } else {
        // Non-GM: GM actions hidden, show only main actions
        if (refs.gmActions) refs.gmActions.hidden = true;
        setTrayMode('user');
    }
    // Always start with host/player actions hidden
    if (refs.hostActions) refs.hostActions.hidden = true;

    // ---------- GM edit mode (click pill) ----------
    let selectedPid = null;
    let selectedName = '';
    let participantsCache = {}; // pid -> {team, displayName,...}
    let lastAssignedTeam = null; // Track last team assignment for success message
    let playerJoinTimeout = null; // Track timeout for player join success message
    let lastPlayerTeam = null; // Track last team player was on

    function updateInstruction(message, isSuccess = false) {
        const instructionEl = root.querySelector('.lobby-instruction');
        if (instructionEl) {
            instructionEl.textContent = message;
            instructionEl.classList.toggle('success', isSuccess);
        }
    }

    function showPlayerActions(pid, name) {
        if (!isGM) return;
        selectedPid = pid; selectedName = (name || '').trim();
        // Hide same-team assign buttons
        const team = participantsCache[pid]?.team || TEAM.NONE;
        if (refs.assignA) refs.assignA.hidden = team === TEAM.A;
        if (refs.assignB) refs.assignB.hidden = team === TEAM.B;
        // Hide kick button if GM selected themselves
        const isMe = pid === uid;
        if (refs.kickPlayer) refs.kickPlayer.hidden = isMe;
        // Update BOTH labels
        if (refs.selectedLabel) refs.selectedLabel.textContent = `Editing: ${selectedName}`;
        if (refs.lobbyStatus) refs.lobbyStatus.textContent = `Editing: ${selectedName}`;
        // Update instruction
        updateInstruction('Move player to a team using the buttons.');
        // Switch tray
        setTrayMode('player');
        // highlight already handled in pill click handler
    }

    function clearPlayerActions() {
        selectedPid = null; selectedName = '';
        // Restore status (participants observer will set it again too)
        if (refs.selectedLabel) refs.selectedLabel.textContent = `Editing: —`;
        if (refs.lobbyStatus) refs.lobbyStatus.textContent = `Choose your team.`;
        // Switch tray back
        setTrayMode(isGM ? 'gm' : 'user');
        // Clear visual selection
        root.querySelectorAll('.pill.is-selected').forEach(b => b.classList.remove('is-selected'));

        // Manually trigger instruction update if we just assigned someone
        if (isGM && lastAssignedTeam) {
            const teamName = lastAssignedTeam === TEAM.A ? teamNames.A : teamNames.B;
            updateInstruction(`✅ Assigned player to ${teamName} team.`, true);
            setTimeout(() => {
                lastAssignedTeam = null;
                // Check if all players are assigned
                const parts = participantsCache;
                const counts = { none: 0 };
                for (const p of Object.values(parts)) {
                    if (p.team === TEAM.NONE) counts.none++;
                }
                if (counts.none === 0 && Object.keys(parts).length > 0) {
                    updateInstruction('Yay! All players assigned to teams.', true);
                } else {
                    updateInstruction('Tap player to assign to a team.');
                }
            }, 3000);
        }
    }

    // Pill rendering
    const pillHTML = ({ pid, label, isMe, clickable }) => {
        const cls = ['pill', isMe ? 'is-me' : '', clickable ? 'is-clickable' : ''].filter(Boolean).join(' ');
        return `<button class="${cls}" data-pid="${pid}" title="${label}">${label}</button>`;
    };
    const renderList = (arr, el) => {
        if (!el) return;
        el.innerHTML = arr.length ? arr.map(pillHTML).join('') : '';
        if (isGM) {
            el.querySelectorAll('.pill.is-clickable').forEach(btn => {
                const pid = btn.getAttribute('data-pid');
                const name = (btn.textContent || '').trim();
                btn.addEventListener('click', () => {
                    root.querySelectorAll('.pill.is-selected').forEach(b => b.classList.remove('is-selected'));
                    btn.classList.add('is-selected');
                    showPlayerActions(pid, name);
                });
            });
        }
    };

    // Status helper
    let lastCanStart = false;
    function statusText(flag) {
        const canStart = (typeof flag === 'boolean') ? flag : lastCanStart;
        return canStart ? 'Ready to start!' : 'Choose your team.';
    }

    // If THIS client disappears from participants (kicked/cleanup), go Home
    if (uid) {
        track(onValue(ref(rtdb, P.participant(gameId, uid)), (s) => {
            if (!s.exists()) {
                exitToHome(disposeAll);
            }
        }));
    }

    // Participants → lists, counts, inline header actions, start enable, hide/show Join Random
    track(onValue(ref(rtdb, P.participants(gameId)), (snap) => {
        const parts = snap.val() || {};
        participantsCache = parts;

        const counts = { A: 0, B: 0, none: 0 };
        const pool = [], A = [], B = [];
        let myTeam = 'none';

        for (const [pid, p] of Object.entries(parts)) {
            const isMe = pid === uid;
            if (isMe) myTeam = p.team || TEAM.NONE;
            const label = p.displayName || pid.slice(-4);
            const pill = { pid, label, isMe, clickable: !!isGM };
            if (p.team === TEAM.A) { counts.A++; A.push(pill); }
            else if (p.team === TEAM.B) { counts.B++; B.push(pill); }
            else { counts.none++; pool.push(pill); }
        }

        pool.sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0));

        renderList(pool, refs.poolList);
        renderList(A, refs.teamAList);
        renderList(B, refs.teamBList);
        if (refs.poolCount) refs.poolCount.textContent = counts.none;
        if (refs.teamACount) refs.teamACount.textContent = `${counts.A}`;
        if (refs.teamBCount) refs.teamBCount.textContent = `${counts.B}`;

        // Update instruction message based on role and state
        if (!selectedPid) { // Not editing a player
            if (isGM) {
                // GM messaging - only update if not in the middle of an assignment
                if (!lastAssignedTeam) {
                    if (counts.none === 0 && Object.keys(parts).length > 0) {
                        updateInstruction('Yay! All players assigned to teams.', true);
                    } else {
                        updateInstruction('Tap player to assign to a team.');
                    }
                }
                // If lastAssignedTeam is set, clearPlayerActions() handles the success message
            } else {
                // Player messaging
                if (myTeam === TEAM.NONE) {
                    updateInstruction('Pick a team to join');
                    // Clear any existing timeout
                    if (playerJoinTimeout) {
                        clearTimeout(playerJoinTimeout);
                        playerJoinTimeout = null;
                    }
                    lastPlayerTeam = null;
                } else {
                    // Check if player just joined a team (team changed)
                    const justJoined = lastPlayerTeam !== myTeam;
                    lastPlayerTeam = myTeam;

                    if (justJoined) {
                        // Clear any existing timeout
                        if (playerJoinTimeout) {
                            clearTimeout(playerJoinTimeout);
                        }

                        // Show success message
                        const teamName = myTeam === TEAM.A ? teamNames.A : teamNames.B;
                        updateInstruction(`✅ Joined ${teamName} team`, true);

                        // Clear success message after 3 seconds
                        playerJoinTimeout = setTimeout(() => {
                            const currentTeam = myTeam === TEAM.A ? teamNames.A : teamNames.B;
                            updateInstruction(`You're on ${currentTeam} team`);
                            playerJoinTimeout = null;
                        }, 3000);
                    }
                }
            }
        }
        // else: instruction is already set by showPlayerActions

        // Start readiness (no longer disable the button, just track status)
        const totalPlaying = counts.A + counts.B;
        const totalAll = totalPlaying + counts.none;
        lastCanStart = teamsEnabled ? counts.A >= 1 && counts.B >= 1 && totalPlaying >= 2 : totalAll >= 1;

        // Inline MY join/leave chips
        const showInline = !!teamsEnabled;
        const setInlineButton = (btn, whichTeam) => {
            if (!btn) return;
            btn.parentElement.style.display = showInline ? '' : 'none';
            if (!showInline) return;
            const amOnThis = myTeam === whichTeam;
            if (amOnThis) {
                btn.textContent = 'Leave';
                btn.title = 'Leave this team';
                btn.disabled = false;
                btn.dataset.action = `leave-${whichTeam}`;
            } else {
                btn.textContent = 'Join';
                btn.title = `Join ${whichTeam === 'A' ? teamNames.A : teamNames.B}`;
                btn.disabled = false;
                btn.dataset.action = `join-${whichTeam}`;
            }
        };
        setInlineButton(refs.teamAAction, 'A');
        setInlineButton(refs.teamBAction, 'B');

        // Join Random visibility (hide when on a team; show when team==none)
        const jr = refs.joinRandom;
        if (jr) {
            jr.style.display = (myTeam === 'none') ? '' : 'none';
        }

        // If not editing a player, refresh status text
        if (!selectedPid && refs.lobbyStatus) refs.lobbyStatus.textContent = statusText(lastCanStart);
    }));

    // Phase: live → dispose lobby listeners, hand off to game UI
    //         ended → everyone Home
    track(onValue(ref(rtdb, P.phase(gameId)), (s) => {
        const phase = s.val();
        if (phase === 'live') {
            // Dispose all lobby listeners before mounting game UI
            disposeAll();
            renderGameUI(gameId);
        } else if (phase === 'ended') {
            exitToHome(disposeAll);
        }
    }));

    // Inline header buttons (MY join/leave)
    if (refs.teamAAction) {
        track(listen(refs.teamAAction, 'click', async () => {
            const act = refs.teamAAction.dataset.action; const me = getCurrentUser()?.uid; if (!me) return;
            if (act === 'join-A') await setTeam(gameId, me, TEAM.A);
            else if (act === 'leave-A') await setTeam(gameId, me, TEAM.NONE);
        }));
    }
    if (refs.teamBAction) {
        track(listen(refs.teamBAction, 'click', async () => {
            const act = refs.teamBAction.dataset.action; const me = getCurrentUser()?.uid; if (!me) return;
            if (act === 'join-B') await setTeam(gameId, me, TEAM.B);
            else if (act === 'leave-B') await setTeam(gameId, me, TEAM.NONE);
        }));
    }

    // Tray: Join Random (works for both GM—moved into gmActions—and non-GM)
    if (refs.joinRandom) track(listen(refs.joinRandom, 'click', async () => {
        const parts = (await get(ref(rtdb, P.participants(gameId)))).val() || {};
        let a = 0, b = 0; Object.values(parts).forEach(p => { if (p.team === TEAM.A) a++; else if (p.team === TEAM.B) b++; });
        const me = getCurrentUser()?.uid; if (!me) return;
        await setTeam(gameId, me, (a <= b) ? TEAM.A : TEAM.B);
    }));

    // Leave Game (non-GM only; link is hidden via CSS for GM)
    if (refs.exitGameBtn) {
        track(listen(refs.exitGameBtn, 'click', async (e) => {
            e?.preventDefault?.();
            await leaveGame(gameId, { uid: getCurrentUser()?.uid || null, dispose: disposeAll });
        }));
    }


    // GM tray actions (only when not editing)
    if (isGM) {
        if (refs.gmStart) {
            track(listen(refs.gmStart, 'click', async () => {
                if (refs.gmStart.dataset.busy === '1') return;

                // Check for unassigned players
                const parts = (await get(ref(rtdb, P.participants(gameId)))).val() || {};
                const unassigned = Object.keys(parts).filter(pid => {
                    const team = parts[pid]?.team || TEAM.NONE;
                    return team === TEAM.NONE;
                });

                // If there are unassigned players, show modal
                if (unassigned.length > 0) {
                    const res = await modal.open({
                        title: 'Unassigned Players',
                        body: 'Some players are still unassigned.',
                        actions: [
                            { id: 'cancel', label: 'Cancel', variant: 'secondary' },
                            { id: 'assign', label: 'Assign Players to Random Teams', variant: 'primary' }
                        ]
                    });

                    if (res === 'cancel' || res === 'dismiss') return;

                    // Assign all unassigned players to balanced teams with random order
                    if (res === 'assign') {
                        // Get initial team counts from already-assigned players
                        let a = 0, b = 0;
                        Object.values(parts).forEach(p => {
                            if (p.team === TEAM.A) a++;
                            else if (p.team === TEAM.B) b++;
                        });

                        // Shuffle unassigned players for randomness
                        const shuffled = [...unassigned].sort(() => Math.random() - 0.5);

                        // Assign each player to team with fewer members, updating counts as we go
                        const updates = {};
                        for (const pid of shuffled) {
                            const assignTeam = (a <= b) ? TEAM.A : TEAM.B;
                            updates[`${P.participant(gameId, pid)}/team`] = assignTeam;
                            // Update local counts for next iteration
                            if (assignTeam === TEAM.A) a++;
                            else b++;
                        }

                        try {
                            await update(ref(rtdb), updates);
                        } catch (e) {
                            console.error('Failed to assign players', e);
                            alert('Could not assign players to teams.');
                            return;
                        }
                    }
                }

                // Start the game
                refs.gmStart.dataset.busy = '1';
                try { await update(ref(rtdb, P.state(gameId)), { phase: 'live' }); }
                catch (e) { console.error('Start failed', e); alert('Could not start the game.'); }
                finally { refs.gmStart.dataset.busy = '0'; }
            }));
        }
        if (refs.gmEnd) {
            track(listen(refs.gmEnd, 'click', async (e) => {
                e?.preventDefault?.();

                // Prevent double-clicks
                if (refs.gmEnd.dataset.busy === '1') return;

                // Ask for confirmation
                const res = await confirmEndGame();
                if (res !== 'confirm') return;

                refs.gmEnd.dataset.busy = '1';
                try {
                    await endGame(gameId);
                } catch (e) {
                    console.error('End failed', e);
                    alert('Could not end the game.');
                } finally {
                    refs.gmEnd.dataset.busy = '0';
                }
            }));
        }


        // Player Actions (contextual row)
        if (refs.assignA) track(listen(refs.assignA, 'click', async () => {
            if (!selectedPid) return;
            await setTeam(gameId, selectedPid, TEAM.A);
            lastAssignedTeam = TEAM.A;
            clearPlayerActions();
        }));
        if (refs.assignB) track(listen(refs.assignB, 'click', async () => {
            if (!selectedPid) return;
            await setTeam(gameId, selectedPid, TEAM.B);
            lastAssignedTeam = TEAM.B;
            clearPlayerActions();
        }));
        if (refs.kickPlayer) track(listen(refs.kickPlayer, 'click', async () => {
            if (!selectedPid) return;
            try {
                await remove(ref(rtdb, P.participant(gameId, selectedPid))); // full kick
            } catch (e) {
                console.error('Kick failed', e); alert('Could not kick player.');
            } finally {
                clearPlayerActions();
            }
        }));
        if (refs.cancelEdit) track(listen(refs.cancelEdit, 'click', clearPlayerActions));
    }
}
