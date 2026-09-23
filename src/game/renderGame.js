// src/game/renderGame.js
//
// Picture Twirl — Game Screen Controller (GM-driven)
// -----------------------------------------------------------------------------
// Flow:
// 1. GM clicks a tile  → selectedTile is set in RTDB
// 2. GM clicks OK      → currentQuestion + swirlStartTime are posted; swirl begins
// 3. Players buzz      → buzz pushed to /buzzQueue; swirl pauses on first buzz
// 4. GM clicks Show Answer / Award A / Award B / Back to Board
//
// All host-only writes (selectedTile, currentQuestion, scores, board) only fire
// when isGM is true on this client.
// -----------------------------------------------------------------------------

import { rtdb, getCurrentUser } from '../firebase.js';
import { ref, onValue, update, get, remove, serverTimestamp, onDisconnect as rtdbOnDisconnect } from 'firebase/database';
import * as P from '../data/paths.js';
import { getSession } from '../session.js';
import { on as listen } from '../ui/dom.js';
import { attachCopyButton } from '../ui/copyButton.js';
import { mountTemplate, collectRefs } from '../ui/templates.js';
import { createBoard } from './createBoard.js';
import { startSwirlAnimation, drawUnswirled } from './swirl.js';
import { enqueueBuzz, clearBuzzQueue } from './buzz.js';
import { createDisposer, exitToHome, leaveGame, confirmEndGame, endGame } from './controllerKit.js';
import { renderFinale } from './renderFinale.js';
import { initializeStartingTurn, advanceTurn } from './turn.js';
import { escapeHtml } from '../ui/format.js';
import { burstConfetti } from '../ui/confetti.js';
import { playBuzz, playCorrect, playReveal, unlockAudio } from '../ui/sound.js';
import { TEAM, SWIRL, teamToAnswer } from '../config.js';

export async function renderGameUI(gameId) {
    const app = document.getElementById('app');
    const root = mountTemplate(app, 'tpl-game');
    const refs = collectRefs(root);

    const { isGM, displayName } = getSession();
    const user = getCurrentUser();
    const myUid = user?.uid || null;

    refs.codeEl.textContent = gameId.toUpperCase();
    document.title = 'Picture Twirl — Live Game';

    // Mark root for GM-only CSS hooks
    root.classList.toggle('is-gm', !!isGM);

    // Cleanup registry
    const { track, disposeAll: disposeListeners } = createDisposer();

    // Local cache
    let teams = { A: { name: 'Team A' }, B: { name: 'Team B' } };
    let participants = {};
    let scores = { A: 0, B: 0 };
    let currentTurn = null;       // { team } — which team picks next
    let turnFirstSeen = false;    // skip coin flip on reconnect/refresh
    let selectedTile = null;      // { id, category, value } — GM has picked, not yet posted
    let currentQuestion = null;   // { id, category, imageUrl, value, showAnswer }
    let swirlStartTime = null;    // server timestamp (ms) when the current swirl began
    let serverTimeOffset = 0;     // ms to add to Date.now() to get server time (.info/serverTimeOffset)
    let swirlCtrl = null;
    let lastImageUrl = null;
    let activeBuzzerUid = null;         // uid of the player currently being adjudicated (cleared on Resume)
    let activeBuzzerName = null;        // display name of the active adjudication buzzer
    let meBuzzedThisQuestion = false;   // this player has used their one buzz attempt this question
    let swirlPausedByGM = false;        // GM hit pause (synced via RTDB)
    let prevScores = null;        // detect score increases → celebrate
    let prevBuzzCount = 0;        // detect new buzzes → buzz sound
    let prevShowAnswer = false;   // detect reveal → chime
    let latestBuzzQueue = [];     // mirrors RTDB buzzQueue; re-used when activeBuzzerUid changes
    let boardCompactObserver = null; // cleanup fn for board compact-header scroll listener

    // Cancel any onDisconnect().remove() registered by the lobby so that
    // a player disconnecting during a live game does NOT lose their participant node
    // (connection loss ≠ leaving during a live game).
    if (myUid) {
        rtdbOnDisconnect(ref(rtdb, P.participant(gameId, myUid))).cancel().catch(() => {});
    }

    // Unlock audio on the first user gesture (browsers gate autoplay).
    const unlockOnce = () => unlockAudio();
    window.addEventListener('pointerdown', unlockOnce, { once: true });
    track(() => window.removeEventListener('pointerdown', unlockOnce));

    // ─── Copy code ─────────────────────────────────────────────────────────────
    track(attachCopyButton(refs.copyCodeBtn, () => gameId.toUpperCase()));

    // Clean up all RTDB listeners + swirl (defined early so handlers can reference it)
    function disposeAll() {
        disposeListeners();
        teardownBoardCompact();
        if (swirlCtrl?.cancel) swirlCtrl.cancel();
        swirlCtrl = null;
    }

    // ─── Tray exit links: wire BEFORE async work so they always attach ─────────
    if (refs.exitGameBtn) refs.exitGameBtn.hidden = !!isGM;
    if (refs.gmEndBtn) refs.gmEndBtn.hidden = !isGM;

    if (refs.exitGameBtn) {
        track(listen(refs.exitGameBtn, 'click', async (e) => {
            e.preventDefault();
            if (isGM) return;
            await leaveGame(gameId, { uid: myUid, dispose: disposeAll });
        }));
    }

    async function handleEndGame(btnEl) {
        if (!isGM) return;
        if (btnEl?.dataset.busy === '1') return;
        const res = await confirmEndGame();
        if (res !== 'confirm') return;
        if (btnEl) btnEl.dataset.busy = '1';
        try {
            await endGame(gameId);
        } catch (err) {
            console.error('End failed', err);
            alert('Could not end the game.');
        } finally {
            if (btnEl) btnEl.dataset.busy = '0';
        }
    }

    if (refs.gmEndBtn) {
        track(listen(refs.gmEndBtn, 'click', (e) => {
            e.preventDefault();
            handleEndGame(refs.gmEndBtn);
        }));
    }

    if (refs.gmEndInQuestion) {
        track(listen(refs.gmEndInQuestion, 'click', () => handleEndGame(refs.gmEndInQuestion)));
    }

    // ─── Phase listener: ended → finale ────────────────────────────────────────
    track(onValue(ref(rtdb, P.phase(gameId)), (s) => {
        if (s.val() === 'ended') {
            const teamAIcon = refs.teamAIcon?.textContent?.trim() || '🐕';
            const teamBIcon = refs.teamBIcon?.textContent?.trim() || '🐈';
            renderFinale(gameId, { teamAIcon, teamBIcon, dispose: disposeAll })
                .catch(err => console.error('[renderGame] renderFinale failed:', err));
        }
    }));

    // ─── Title, teams, scores, participants ────────────────────────────────────
    track(onValue(ref(rtdb, P.title(gameId)), (s) => {
        refs.gameTitleEl.textContent = (s.val() || 'Picture Twirl').toString().trim();
    }));

    track(onValue(ref(rtdb, P.teams(gameId)), (s) => {
        teams = s.val() || teams;
        const nameA = titleCase(teams.A?.name || 'Team A');
        const nameB = titleCase(teams.B?.name || 'Team B');
        refs.teamAName.textContent = nameA;
        refs.teamBName.textContent = nameB;
        // Keep award button labels in sync with actual team names.
        const labelA = refs.awardABtn?.querySelector('.gm-icon-btn__label');
        const labelB = refs.awardBBtn?.querySelector('.gm-icon-btn__label');
        if (labelA) labelA.textContent = nameA;
        if (labelB) labelB.textContent = nameB;
        if (refs.awardABtn) refs.awardABtn.title = `Award ${nameA}`;
        if (refs.awardBBtn) refs.awardBBtn.title = `Award ${nameB}`;
        updateIdentityRow();
    }));

    track(onValue(ref(rtdb, P.scores(gameId)), (s) => {
        const v = s.val() || {};
        scores = { A: Number(v.A || 0), B: Number(v.B || 0) };
        refs.teamAScore.textContent = scores.A;
        refs.teamBScore.textContent = scores.B;

        // A score went up → a team got it right. Celebrate (all clients).
        if (prevScores && (scores.A > prevScores.A || scores.B > prevScores.B)) {
            const team = scores.A > prevScores.A ? TEAM.A : TEAM.B;
            burstConfetti({ originX: team === TEAM.A ? 0.3 : 0.7, originY: 0.35 });
            playCorrect();
        }
        prevScores = scores;
    }));

    track(onValue(ref(rtdb, P.participants(gameId)), (s) => {
        const prev = participants;
        participants = s.val() || {};
        updateTurnGlow();
        updateIdentityRow();
        updateYouBadge();

        if (isGM) {
            // Detect active players who have disappeared (explicit leave / removal).
            // Skip on first fire (prev is {}) to avoid false positives.
            if (Object.keys(prev).length > 0) {
                for (const [depUid, depP] of Object.entries(prev)) {
                    if (depP.isGM || depP.status === 'pending') continue;
                    if (!participants[depUid]) {
                        showGMLeaveNotice(depP.displayName || 'Player', depP.team);
                        // If this was the active adjudication buzzer, clear safely
                        if (depUid === activeBuzzerUid) {
                            activeBuzzerUid = null;
                            activeBuzzerName = null;
                            update(ref(rtdb, P.game(gameId)), { swirlPaused: false }).catch(console.error);
                            updateStatusMessage();
                            updateBuzzButton();
                        }
                    }
                }
            }

            // Show/update the pending-join approval banner
            updateApprovalBanner();

            // Promote tile requests (only when no active question/tile)
            if (!currentQuestion && !selectedTile) {
                for (const [uid, p] of Object.entries(participants)) {
                    if (p.tileRequest && p.team === currentTurn?.team) {
                        const req = p.tileRequest;
                        update(ref(rtdb), {
                            [`${P.game(gameId)}/selectedTile`]: { id: req.id, category: req.category, value: req.value },
                            [`${P.participant(gameId, uid)}/tileRequest`]: null
                        }).catch(err => console.error('Tile request promotion failed:', err));
                        break;
                    }
                }
            }
        }
    }));

    track(onValue(ref(rtdb, `${P.game(gameId)}/currentTurn`), (s) => {
        const val = s.val();
        if (!turnFirstSeen) {
            // First snapshot on mount — existing state, no animation.
            turnFirstSeen = true;
        } else if (!currentTurn && val) {
            // Null → value: game just started, show coin flip.
            showCoinFlip(val.team);
        }
        currentTurn = val;
        updateActiveTurnDisplay();
        updateStatusMessage();
        updateTurnGlow();
    }));

    track(onValue(ref(rtdb, `${P.game(gameId)}/selectedTile`), (s) => {
        selectedTile = s.val();
        updateBoardSelection();
        updateStatusMessage();
        updateOkButton();
        updateTurnGlow();
    }));

    // ─── Current question (drives the viewer) ──────────────────────────────────
    track(onValue(ref(rtdb, `${P.game(gameId)}/currentQuestion`), (s) => {
        currentQuestion = s.val();
        renderQuestionViewer();
        updateStatusMessage();
        updateActiveTurnDisplay(); // question start clears border; question end restores turn border
    }));

    track(onValue(ref(rtdb, `${P.game(gameId)}/swirlStartTime`), (s) => {
        swirlStartTime = typeof s.val() === 'number' ? s.val() : null;
    }));

    // Clock skew between this device and Firebase. swirlStartTime is a server
    // timestamp, so comparing it against a raw Date.now() puts a client whose
    // clock runs ahead straight to the end of the reveal (or behind → late).
    track(onValue(ref(rtdb, '.info/serverTimeOffset'), (s) => {
        serverTimeOffset = Number(s.val()) || 0;
    }));

    // ─── Buzz queue ────────────────────────────────────────────────────────────
    // Renders the buzz-queue pill list.  Must be called any time activeBuzzerUid
    // changes (new buzz, Resume) so the is-active class tracks the current buzzer,
    // not the first-child DOM position.
    function renderBuzzQueue() {
        if (!refs.buzzQueueEl) return;
        refs.buzzQueueEl.innerHTML = latestBuzzQueue.length
            ? latestBuzzQueue.map(e => {
                const name = participants?.[e.uid]?.displayName || 'Player';
                const active = activeBuzzerUid && e.uid === activeBuzzerUid;
                return `<div class="buzz-entry${active ? ' is-active' : ''}">${escapeHtml(name)}</div>`;
            }).join('')
            : '';
    }

    track(onValue(ref(rtdb, P.buzzQueue(gameId)), (s) => {
        const obj = s.val() || {};
        const ordered = Object.values(obj)
            .filter(e => e && typeof e.createdAt === 'number')
            .sort((a, b) => a.createdAt - b.createdAt);

        // Set activeBuzzerUid BEFORE rendering so the correct pill gets is-active.
        // New buzz arrived — sound, set active adjudication buzzer, auto-pause.
        if (ordered.length > prevBuzzCount) {
            playBuzz();
            // The FIRST new entry of this wave (ordered[prevBuzzCount], FIFO) becomes the
            // active adjudication buzzer. Guard: don't overwrite an already-active one —
            // near-simultaneous late entries in the same wave don't change who is being judged.
            if (!activeBuzzerUid) {
                const firstNew = ordered[prevBuzzCount];
                if (firstNew) {
                    activeBuzzerUid = firstNew.uid || null;
                    activeBuzzerName = activeBuzzerUid
                        ? (participants?.[activeBuzzerUid]?.displayName || null)
                        : null;
                }
            }
            // GM writes swirlPaused:true so every client pauses via the shared RTDB listener.
            if (isGM && currentQuestion && !currentQuestion.showAnswer && !swirlPausedByGM) {
                update(ref(rtdb, P.game(gameId)), { swirlPaused: true }).catch(console.error);
            }
        }
        prevBuzzCount = ordered.length;
        latestBuzzQueue = ordered;
        renderBuzzQueue();
        applySwirlPause();
        refreshSwirlLabel();
        updateStatusMessage();
        updateActiveTurnDisplay(); // shifts border to buzzer's team on new buzz; clears on queue empty

        // Track this player's per-question buzz attempt and re-render the button.
        if (!isGM) {
            meBuzzedThisQuestion = ordered.some(e => e.uid === myUid);
            updateBuzzButton();
        }
    }));

    // ─── Swirl pause (GM-controlled, synced to all clients) ────────────────────
    track(onValue(ref(rtdb, P.swirlPaused(gameId)), (s) => {
        swirlPausedByGM = s.val() === true;
        // Resume clears the active adjudication buzzer so the next buzz starts a fresh wave.
        if (!swirlPausedByGM) { activeBuzzerUid = null; activeBuzzerName = null; }
        renderBuzzQueue(); // re-stamp pills: clears is-active on Resume, no-op otherwise
        applySwirlPause();
        updatePauseButton();
        refreshSwirlLabel();
        updateStatusMessage();
        updateBuzzButton();
        updateActiveTurnDisplay(); // Resume clears buzz-adjudication border; manual pause keeps it clear
    }));

    // Pause/resume based solely on the shared swirlPaused RTDB flag.
    // hasBuzz is display-only; the GM client writes swirlPaused:true on each new
    // buzz so every client pauses through the same listener — one source of truth.
    // This means Pause/Resume always works: Resume writes swirlPaused:false and
    // the animation actually resumes even if the buzz queue is still non-empty.
    // Never act once the answer is revealed (the swirl is gone by then).
    function applySwirlPause() {
        if (!swirlCtrl || currentQuestion?.showAnswer) return;
        if (swirlPausedByGM) swirlCtrl.pause?.();
        else swirlCtrl.resume?.();
    }

    // Draw the fully-clear image onto the swirl canvas (used on answer reveal).
    // Same working-resolution cap as the swirl so a huge source can't exceed
    // mobile canvas limits at reveal time.
    function unswirlImage() {
        drawUnswirled(refs.twirlImage, refs.twirlCanvas);
    }

    function updatePauseButton() {
        if (!refs.pauseSwirlBtn) return;
        refs.pauseSwirlBtn.dataset.paused = swirlPausedByGM ? 'true' : 'false';
        const label = refs.pauseSwirlBtn.querySelector('.gm-icon-btn__label');
        if (label) label.textContent = swirlPausedByGM ? 'Resume' : 'Pause';
    }

    // ─── Late-join approval banner (GM only) ────────────────────────────────────
    let joinApprovalEl = null;

    function getApprovalEl() {
        if (joinApprovalEl) return joinApprovalEl;
        joinApprovalEl = document.createElement('div');
        joinApprovalEl.className = 'join-request-toast';
        joinApprovalEl.hidden = true;
        root.appendChild(joinApprovalEl);
        return joinApprovalEl;
    }

    async function approveJoiner(pendingUid, team) {
        const eligibleFromQuestionId = currentQuestion?.id || null;
        await update(ref(rtdb, P.participant(gameId, pendingUid)), {
            team,
            status: 'active',
            eligibleFromQuestionId,
        });
    }

    function updateApprovalBanner() {
        if (!isGM) return;
        const pending = Object.entries(participants)
            .filter(([, p]) => p.status === 'pending')
            .map(([uid, p]) => ({ uid, name: p.displayName || 'Player' }));

        const el = getApprovalEl();

        if (!pending.length) {
            el.hidden = true;
            el.innerHTML = '';
            return;
        }

        const { uid: pendingUid, name: pendingName } = pending[0];
        const teamAName = escapeHtml(teams.A?.name || 'Team A');
        const teamBName = escapeHtml(teams.B?.name || 'Team B');

        el.hidden = false;
        el.innerHTML = `
            <div class="jrt-body">
                <span class="jrt-text"><strong>${escapeHtml(pendingName)}</strong> wants to join</span>
                <div class="jrt-actions">
                    <button class="btn ghost jrt-deny">Deny</button>
                    <button class="btn ghost jrt-team" data-team="A">${teamAName}</button>
                    <button class="btn ghost jrt-team" data-team="B">${teamBName}</button>
                    <button class="btn primary jrt-random">Random</button>
                </div>
            </div>`;

        el.querySelector('.jrt-deny').addEventListener('click', () => {
            remove(ref(rtdb, P.participant(gameId, pendingUid))).catch(console.error);
        });

        el.querySelectorAll('.jrt-team').forEach(btn => {
            btn.addEventListener('click', () => approveJoiner(pendingUid, btn.dataset.team).catch(console.error));
        });

        el.querySelector('.jrt-random').addEventListener('click', () => {
            let a = 0, b = 0;
            Object.values(participants).forEach(p => {
                if (p.status === 'active') {
                    if (p.team === TEAM.A) a++;
                    else if (p.team === TEAM.B) b++;
                }
            });
            approveJoiner(pendingUid, a <= b ? TEAM.A : TEAM.B).catch(console.error);
        });
    }

    // Small ephemeral toast shown to GM when a player leaves.
    function showGMLeaveNotice(name, team) {
        const teamName = team === TEAM.A ? (teams.A?.name || 'Team A')
            : team === TEAM.B ? (teams.B?.name || 'Team B')
            : null;
        const msg = teamName ? `${name} left the game · ${teamName}` : `${name} left the game`;
        const el = document.createElement('div');
        el.className = 'game-leave-toast';
        el.textContent = msg;
        root.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    // Unified buzz button presenter. Three states:
    //   • enabled "BUZZ IN"   — eligible player, reveal running
    //   • disabled "BUZZ IN"  — reveal paused (GM or buzz), player hasn't spent their attempt
    //   • disabled "BUZZED"   — this player buzzed and reveal is currently paused
    //   • disabled "BUZZ USED"— this player buzzed and reveal has since resumed
    // swirlPausedByGM answers "can anyone buzz?" (reveal running vs paused).
    // meBuzzedThisQuestion answers "has THIS player spent their one attempt?"
    function updateBuzzButton() {
        if (!refs.buzzBtn || isGM) return;
        const active = !!currentQuestion && !currentQuestion.showAnswer;
        if (!active) return; // visibility is controlled by renderQuestionViewer

        // Late joiner: ineligible for the question that was active when they joined.
        const me = participants?.[myUid];
        const waitingForNext = me?.eligibleFromQuestionId &&
            me.eligibleFromQuestionId === currentQuestion?.id;
        if (waitingForNext) {
            refs.buzzBtn.disabled = true;
            refs.buzzBtn.textContent = 'NEXT QUESTION';
            return;
        }

        if (meBuzzedThisQuestion) {
            refs.buzzBtn.disabled = true;
            // BUZZED = I am the current adjudication subject; BUZZ USED = I spent my attempt but I'm not current.
            const iAmActive = activeBuzzerUid === myUid && swirlPausedByGM;
            refs.buzzBtn.textContent = iAmActive ? 'BUZZED' : 'BUZZ USED';
        } else {
            refs.buzzBtn.disabled = swirlPausedByGM;
            refs.buzzBtn.textContent = 'BUZZ IN';
        }
    }

    // Progress bar label: reflects the ACTIVE adjudication state, not the persistent queue history.
    function refreshSwirlLabel() {
        if (!refs.swirlLabel) return;
        if (activeBuzzerUid) {
            if (!isGM && activeBuzzerUid === myUid) {
                refs.swirlLabel.textContent = 'You buzzed!';
            } else {
                refs.swirlLabel.textContent = activeBuzzerName
                    ? `Buzzed in · ${activeBuzzerName}`
                    : 'Buzzed in';
            }
        } else if (swirlPausedByGM) {
            refs.swirlLabel.textContent = 'Paused';
        } else {
            refs.swirlLabel.textContent = 'Revealing…';
        }
    }

    // Reveal-progress bar driven by the swirl's onProgress callback.
    function setSwirlProgress(progress) {
        if (refs.swirlFill) refs.swirlFill.style.width = `${Math.round(progress * 100)}%`;
        if (refs.swirlLabel) {
            if (progress >= 1) {
                refs.swirlLabel.textContent = 'Revealed!';
            } else {
                refreshSwirlLabel();
            }
        }
    }

    // ─── Coin flip overlay (shown once when the first turn is assigned) ────────
    function showCoinFlip(team) {
        const teamName = titleCase(teams[team]?.name || `Team ${team}`);
        const overlay = document.createElement('div');
        overlay.className = 'coin-flip-overlay';
        overlay.innerHTML = `
            <div class="coin-flip-card">
                <div class="coin-flip-coin" aria-hidden="true">🪙</div>
                <div class="coin-flip-team">${escapeHtml(teamName)}</div>
                <div class="coin-flip-sub">picks first!</div>
            </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('is-visible'));
        const cleanup = () => { overlay.classList.remove('is-visible'); setTimeout(() => overlay.remove(), 400); };
        setTimeout(cleanup, 3500);
        track(() => overlay.remove());
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    // Capitalize the first letter of each word — for team name display only.
    // Never applied to player names (preserve as entered).
    function titleCase(str) {
        if (!str) return str;
        return str.replace(/\b\w/g, c => c.toUpperCase());
    }

    // Orange border = "this team currently has the floor / is performing the exclusive action".
    // Derived fresh from current state every call — no separate tracking variable needed.
    //   Board (including tile pre-selected): turn team is choosing → show border
    //   Buzz adjudication (paused + buzz in queue): buzzer's team holds floor → show border
    //   Active reveal, manual GM pause, answer shown: no team has exclusive floor → no border
    function updateActiveTurnDisplay() {
        let activeActionTeam = null;

        if (!currentQuestion && currentTurn) {
            // Board: the turn team is choosing the next category.
            activeActionTeam = currentTurn.team;
        } else if (currentQuestion && !currentQuestion.showAnswer && activeBuzzerUid && swirlPausedByGM) {
            // Buzz adjudication: the currently-active buzzer's team holds the floor.
            activeActionTeam = participants?.[activeBuzzerUid]?.team || null;
        }
        // Active reveal, manual GM pause, or answer shown → no border.

        refs.teamACard?.classList.toggle('is-active', activeActionTeam === TEAM.A);
        refs.teamBCard?.classList.toggle('is-active', activeActionTeam === TEAM.B);
        if (refs.teamAPlayer) refs.teamAPlayer.textContent = '';
        if (refs.teamBPlayer) refs.teamBPlayer.textContent = '';
    }

    // ─── Identity row: who am I / what role / which team ──────────────────
    function updateIdentityRow() {
        if (!refs.identityRow) return;
        const myTeamKey = !isGM ? (participants[myUid]?.team || null) : null;
        const icon = isGM
            ? '👑'
            : (myTeamKey ? (refs[`team${myTeamKey}Icon`]?.textContent?.trim() || '') : '');
        // Prefer RTDB participant record (available once listener fires); fall back to session.
        const name = participants[myUid]?.displayName || displayName || 'Player';
        const roleLabel = isGM
            ? 'GM'
            : (myTeamKey && (myTeamKey === TEAM.A || myTeamKey === TEAM.B)
                ? titleCase(teams[myTeamKey]?.name || `Team ${myTeamKey}`)
                : 'No team');

        refs.identityRow.textContent = '';
        const chip = document.createElement('span');
        chip.className = 'identity-chip';
        chip.textContent = `${icon} ${name} · ${roleLabel}`;
        refs.identityRow.appendChild(chip);
    }

    // YOU badge: marks the player's own team scorecard (never shown to GM).
    function updateYouBadge() {
        if (isGM) {
            if (refs.teamAYou) refs.teamAYou.hidden = true;
            if (refs.teamBYou) refs.teamBYou.hidden = true;
            return;
        }
        const myTeamKey = participants[myUid]?.team || null;
        if (refs.teamAYou) refs.teamAYou.hidden = myTeamKey !== TEAM.A;
        if (refs.teamBYou) refs.teamBYou.hidden = myTeamKey !== TEAM.B;
    }

    function updateStatusMessage() {
        if (!refs.statusMessage) return;
        // Clear rich-state classes up front; branches re-add when appropriate.
        refs.statusMessage.classList.remove('is-adjudicating', 'is-resolved');

        if (currentQuestion) {
            const { category, value, showAnswer } = currentQuestion;
            if (isGM) {
                if (showAnswer) {
                    // Resolved — question over, image and answer are public.
                    const awardedTeam = currentQuestion.awardedTeam || null;
                    refs.statusMessage.classList.add('is-resolved');
                    if (awardedTeam) {
                        const teamName = titleCase(teams[awardedTeam]?.name || `Team ${awardedTeam}`);
                        const pts = currentQuestion.value || 0;
                        refs.statusMessage.innerHTML =
                            `<div class="gsr-result is-award">${escapeHtml(teamName)} got it! +${pts}</div>` +
                            `<div class="gsr-answer">Answer: <strong>${escapeHtml(currentQuestion.answer || '')}</strong></div>` +
                            `<div class="gsr-hint">Continue when everyone is ready.</div>`;
                    } else {
                        refs.statusMessage.innerHTML =
                            `<div class="gsr-result">Revealed</div>` +
                            `<div class="gsr-answer">Answer: <strong>${escapeHtml(currentQuestion.answer || '')}</strong></div>` +
                            `<div class="gsr-hint">Continue when everyone is ready.</div>`;
                    }
                } else if (activeBuzzerUid) {
                    // Adjudication — player buzzed, GM decides.
                    const buzzerTeam = participants?.[activeBuzzerUid]?.team || null;
                    const teamName = buzzerTeam
                        ? titleCase(teams[buzzerTeam]?.name || `Team ${buzzerTeam}`)
                        : null;
                    const who = activeBuzzerName || 'Player';
                    const answer = currentQuestion.answer || '—';
                    const awardLabel = teamName ? `Award ${teamName}` : 'Award team';
                    refs.statusMessage.classList.add('is-adjudicating');
                    refs.statusMessage.innerHTML =
                        `<div class="gsa-buzzer">${escapeHtml(who)}${teamName ? ` · ${escapeHtml(teamName)}` : ''} buzzed in</div>` +
                        `<div class="gsa-answer">Answer: <strong>${escapeHtml(answer)}</strong></div>` +
                        `<div class="gsa-hint">Correct → ${escapeHtml(awardLabel)} &nbsp;·&nbsp; Incorrect → Resume</div>`;
                } else {
                    // Normal — reveal running or manually paused.
                    refs.statusMessage.textContent = swirlPausedByGM
                        ? `${category} · $${value} — Paused`
                        : `${category} · $${value} — Revealing`;
                }
            } else {
                // Player status: normally hidden, but shown in the compact header for context.
                let playerStatus;
                if (showAnswer) {
                    playerStatus = `${category} · $${value} — Revealed`;
                } else if (activeBuzzerUid) {
                    playerStatus = activeBuzzerUid === myUid
                        ? `${category} · $${value} — You buzzed!`
                        : `${category} · $${value} — Buzzed`;
                } else {
                    playerStatus = `${category} · $${value}`;
                }
                refs.statusMessage.textContent = playerStatus;
            }
            return;
        }

        if (selectedTile) {
            const { category, value } = selectedTile;
            refs.statusMessage.textContent = isGM
                ? `Selected: ${category} for $${value} — press OK to start`
                : `Host is starting ${category} for $${value}…`;
            return;
        }

        if (currentTurn) {
            const teamName = titleCase(teams[currentTurn.team]?.name || `Team ${currentTurn.team}`);
            const isMyTeamsTurn = !isGM && participants[myUid]?.team === currentTurn.team;
            refs.statusMessage.textContent = isMyTeamsTurn
                ? `Your team — pick a category!`
                : `${teamName} is picking a category`;
            return;
        }

        refs.statusMessage.textContent = 'Waiting for the next tile…';
    }

    // Pulse the board border for the player whose team is picking.
    function updateTurnGlow() {
        if (!refs.statusMessage) return;
        const isMyTeamsTurn = !isGM && currentTurn?.team && participants[myUid]?.team === currentTurn.team;
        refs.statusMessage.classList.toggle('is-my-turn', !!isMyTeamsTurn && !selectedTile && !currentQuestion);
    }

    function updateBoardSelection() {
        document.querySelectorAll('.tile.selected').forEach(t => t.classList.remove('selected'));
        if (selectedTile) {
            const el = document.querySelector(`.tile[data-id="${selectedTile.id}"]`);
            if (el) el.classList.add('selected');
        }
    }

    function updateOkButton() {
        if (!refs.okBtn) return;
        // OK only visible/enabled for GM with a tile selected and no active question
        const shouldShow = isGM && !currentQuestion;
        refs.okBtn.hidden = !shouldShow;
        refs.okBtn.disabled = !selectedTile;
    }

    // Hide status message for players during a question (GM always sees it).
    function syncStatusVisibility() {
        if (!refs.statusMessage) return;
        refs.statusMessage.hidden = !!currentQuestion && !isGM;
    }

    // ─── Board compact header (scroll-driven, board view only) ──────────────────
    // Collapse threshold / hysteresis.
    // On iPhone the board overflows game-main by only ~30-55 px, so the threshold
    // must be well below that ceiling to be reachable during normal scrolling.
    const BOARD_COLLAPSE_AT = 16; // px — collapse after first intentional swipe
    const BOARD_EXPAND_AT   =  6; // px — expand only when nearly back at the top

    function setupBoardCompact() {
        if (boardCompactObserver) return; // already active
        if (!refs.gameMain) return;
        root.classList.remove('is-board-compact'); // always start expanded

        function onBoardScroll() {
            const st = refs.gameMain.scrollTop;
            const compact = root.classList.contains('is-board-compact');
            if (!compact && st > BOARD_COLLAPSE_AT) {
                root.classList.add('is-board-compact');
            } else if (compact && st < BOARD_EXPAND_AT) {
                // Guard: only expand if the board still meaningfully overflows.
                // When collapsing the header makes the board fit within game-main,
                // the browser snaps scrollTop to 0 — that snap must not trigger a
                // re-expand, or the header will oscillate (flash).
                const maxScroll = refs.gameMain.scrollHeight - refs.gameMain.clientHeight;
                if (maxScroll > BOARD_COLLAPSE_AT) root.classList.remove('is-board-compact');
            }
        }

        refs.gameMain.addEventListener('scroll', onBoardScroll, { passive: true });
        boardCompactObserver = () => {
            refs.gameMain.removeEventListener('scroll', onBoardScroll);
            root.classList.remove('is-board-compact');
        };
    }

    function teardownBoardCompact() {
        if (!boardCompactObserver) return;
        boardCompactObserver();
        boardCompactObserver = null;
    }

    function renderQuestionViewer() {
        const active = !!currentQuestion;

        // Toggle board vs viewer
        if (refs.boardWrap) refs.boardWrap.hidden = active;
        if (refs.viewerEl) refs.viewerEl.hidden = !active;
        syncStatusVisibility();
        if (refs.okBtn) refs.okBtn.hidden = active || !isGM;

        // Buzz button: non-GM, only while question is active and answer not yet shown
        if (refs.buzzBtn) {
            refs.buzzBtn.hidden = isGM || !active || !!currentQuestion?.showAnswer;
        }
        if (!isGM && active) updateBuzzButton();

        // GM controls: only GM, only while question is active
        if (refs.gmControls) refs.gmControls.hidden = !isGM || !active;
        // End game link: board-mode fallback — hidden during question (icon bar covers it)
        if (refs.gmEndBtn) refs.gmEndBtn.hidden = !isGM || active;

        updateTurnGlow();

        // Switch to focused question mode (hides header chrome; see gameBoard.css).
        const wasInQuestion = root.classList.contains('is-in-question');
        root.classList.toggle('is-in-question', active);

        if (active && !wasInQuestion) {
            // Board → Question: remove board compact, reset scroll so viewer starts at top.
            teardownBoardCompact();
            if (refs.gameMain) refs.gameMain.scrollTop = 0;
        } else if (!active && wasInQuestion) {
            // Question → Board: reset scroll so header starts fully expanded.
            if (refs.gameMain) refs.gameMain.scrollTop = 0;
            setupBoardCompact();
        }

        if (!active) {
            meBuzzedThisQuestion = false; // fresh eligibility for the next question
            activeBuzzerUid = null;       // clear adjudication state
            activeBuzzerName = null;
            // Cancel swirl if running
            if (swirlCtrl?.cancel) swirlCtrl.cancel();
            swirlCtrl = null;
            lastImageUrl = null;
            prevShowAnswer = false;
            // Wipe canvas and image so the old picture doesn't flash on the next question.
            if (refs.twirlCanvas) {
                const ctx = refs.twirlCanvas.getContext('2d');
                ctx?.clearRect(0, 0, refs.twirlCanvas.width, refs.twirlCanvas.height);
            }
            if (refs.twirlImage) refs.twirlImage.src = '';
            if (refs.answerEl) {
                refs.answerEl.hidden = true;
                refs.answerEl.textContent = '';
            }
            if (refs.resolvedInfoEl) refs.resolvedInfoEl.hidden = true;
            return;
        }

        // Reveal chime on the false → true transition, but not when awarding
        // (the score listener plays playCorrect() + confetti for that case).
        if (currentQuestion.showAnswer && !prevShowAnswer && !currentQuestion.awardedTeam) playReveal();
        prevShowAnswer = !!currentQuestion.showAnswer;

        // Render question metadata
        if (refs.qCategory) refs.qCategory.textContent = currentQuestion.category || '';
        if (refs.qValue) refs.qValue.textContent = `$${currentQuestion.value ?? ''}`;

        // Swirl timer + active-play controls disappear once the answer is revealed.
        const resolved = !!currentQuestion.showAnswer;
        if (refs.swirlTimer) refs.swirlTimer.hidden = resolved;
        if (refs.pauseSwirlBtn) refs.pauseSwirlBtn.hidden = resolved;
        if (refs.showAnswerBtn) refs.showAnswerBtn.hidden = resolved;
        // Award buttons are also irrelevant after resolution.
        if (refs.awardABtn) refs.awardABtn.hidden = resolved;
        if (refs.awardBBtn) refs.awardBBtn.hidden = resolved;
        // Board-return button becomes "Continue" in the resolved state.
        const backLabel = refs.backToBoardBtn?.querySelector('.gm-icon-btn__label');
        if (backLabel) backLabel.textContent = resolved ? 'Continue' : 'Board';

        // Load image and (re)start swirl when URL changes
        if (refs.twirlImage && currentQuestion.imageUrl && currentQuestion.imageUrl !== lastImageUrl) {
            setSwirlProgress(0);
            refs.twirlImage.onload = () => {
                if (swirlCtrl?.cancel) swirlCtrl.cancel();
                // Server-aligned: how far into the reveal everyone else already is.
                const serverNow = Date.now() + serverTimeOffset;
                const elapsed = swirlStartTime ? Math.max(0, serverNow - swirlStartTime) : 0;
                swirlCtrl = startSwirlAnimation(
                    refs.twirlImage,
                    refs.twirlCanvas,
                    SWIRL.DURATION_MS,
                    SWIRL.STRENGTH,
                    elapsed,
                    setSwirlProgress
                );
                // Respect any pause state that's already active for this question.
                applySwirlPause();
            };
            refs.twirlImage.src = currentQuestion.imageUrl;
            lastImageUrl = currentQuestion.imageUrl;
        }

        // Answer display and resolved-info banner
        if (currentQuestion.showAnswer) {
            if (refs.answerEl) {
                refs.answerEl.textContent = currentQuestion.answer || '';
                refs.answerEl.hidden = false;
            }
            // Stop swirl and draw the clear image at reveal.
            if (swirlCtrl?.cancel) swirlCtrl.cancel();
            swirlCtrl = null;
            unswirlImage();
            setSwirlProgress(1);

            // Resolved-info banner: show team award credit to all clients.
            if (refs.resolvedInfoEl) {
                const awardedTeam = currentQuestion.awardedTeam || null;
                if (awardedTeam) {
                    const teamName = titleCase(teams[awardedTeam]?.name || `Team ${awardedTeam}`);
                    const pts = currentQuestion.value || 0;
                    refs.resolvedInfoEl.textContent = `${teamName} · +${pts}`;
                    refs.resolvedInfoEl.hidden = false;
                } else {
                    refs.resolvedInfoEl.hidden = true;
                }
            }
        } else {
            if (refs.answerEl) {
                refs.answerEl.hidden = true;
                refs.answerEl.textContent = '';
            }
            if (refs.resolvedInfoEl) refs.resolvedInfoEl.hidden = true;
        }
    }

    // ─── Initialize: pick a random starting player (GM only, once) ─────────────
    if (isGM) initializeStartingTurn(gameId);

    // ─── Board ─────────────────────────────────────────────────────────────────
    try {
        const boardEl = await createBoard(gameId, {
            onTileClick: async (tileData) => {
                const isMyTeamsTurn = currentTurn?.team && participants[myUid]?.team === currentTurn.team;
                if (!isGM && !isMyTeamsTurn) return; // only GM or the active team may pick
                if (currentQuestion) return;         // question already active
                if (tileData.answered) return;

                if (isGM) {
                    // GM can write selectedTile directly.
                    await update(ref(rtdb, P.game(gameId)), {
                        selectedTile: { id: tileData.id, category: tileData.category, value: tileData.value }
                    });
                } else {
                    // Players can't write to the game root (Firebase rules). Write a
                    // request to their own participant node; the GM client promotes it above.
                    await update(ref(rtdb, P.participant(gameId, myUid)), {
                        tileRequest: { id: tileData.id, category: tileData.category, value: tileData.value }
                    });
                }
            }
        });
        refs.boardEl.replaceWith(boardEl);
        refs.boardEl = boardEl;
    } catch (e) {
        console.error('Failed to render board:', e);
        refs.boardEl.textContent = 'Error rendering board.';
    }

    // ─── OK button (GM confirms a selected tile → posts question) ──────────────
    track(listen(refs.okBtn, 'click', async () => {
        if (!isGM) return;
        if (!selectedTile) return;
        if (refs.okBtn.dataset.busy === '1') return;
        refs.okBtn.dataset.busy = '1';

        try {
            // Get full tile data to recover imageUrl + answer
            const tileSnap = await get(ref(rtdb, P.boardTile(gameId, selectedTile.id)));
            const tile = tileSnap.val();
            if (!tile) throw new Error('Tile not found');

            await update(ref(rtdb, P.game(gameId)), {
                currentQuestion: {
                    id: tile.id,
                    category: tile.category,
                    imageUrl: tile.imageUrl,
                    answer: tile.answer,
                    value: Number(tile.value || 0),
                    showAnswer: false
                },
                swirlStartTime: serverTimestamp(),
                swirlPaused: false,
                selectedTile: null
            });

            // Mark tile opened (separate update to keep paths clean)
            await update(ref(rtdb, P.boardTile(gameId, tile.id)), {
                opened: true,
                lastActionAt: serverTimestamp()
            });
        } catch (err) {
            console.error('Failed to post question:', err);
        } finally {
            refs.okBtn.dataset.busy = '0';
        }
    }));

    // ─── GM controls: Pause / Show Answer / Award / Back to Board ──────────────
    if (refs.pauseSwirlBtn) {
        track(listen(refs.pauseSwirlBtn, 'click', async () => {
            if (!isGM || !currentQuestion) return;
            // Toggle the shared pause flag; all clients react via the listener.
            await update(ref(rtdb, P.game(gameId)), { swirlPaused: !swirlPausedByGM });
        }));
    }

    if (refs.showAnswerBtn) {
        track(listen(refs.showAnswerBtn, 'click', async () => {
            if (!isGM || !currentQuestion) return;
            await update(ref(rtdb, P.currentQuestion(gameId)), { showAnswer: true });
        }));
    }

    async function awardTeam(teamKey) {
        if (!isGM || !currentQuestion?.id) return;
        if (currentQuestion.awardedTeam) return; // already awarded — double-click guard

        const points = Number(currentQuestion.value || 0);
        const scorePath = P.score(gameId, teamKey);
        const tilePath = P.boardTile(gameId, currentQuestion.id);
        const buzzerUid = activeBuzzerUid; // capture before any await

        const [scoreSnap, participantSnap] = await Promise.all([
            get(ref(rtdb, scorePath)),
            buzzerUid ? get(ref(rtdb, P.participant(gameId, buzzerUid))) : Promise.resolve(null),
        ]);

        const curScore = scoreSnap.exists() ? Number(scoreSnap.val() || 0) : 0;
        const pVal = participantSnap?.val() || {};

        // Reveal the image + mark resolved, but keep currentQuestion visible so
        // all clients linger on the result. Continue to Board clears it later.
        const writes = {
            [scorePath]: curScore + points,
            [`${tilePath}/answered`]: true,
            [`${tilePath}/answeredBy`]: teamToAnswer(teamKey),
            [`${tilePath}/awardedPoints`]: points,
            [`${tilePath}/lastActionAt`]: serverTimestamp(),
            [`${P.currentQuestion(gameId)}/showAnswer`]: true,
            [`${P.currentQuestion(gameId)}/awardedTeam`]: teamKey,
            [`${P.game(gameId)}/swirlPaused`]: false,
        };

        if (buzzerUid) {
            writes[`${P.participant(gameId, buzzerUid)}/pointsEarned`] = Number(pVal.pointsEarned || 0) + points;
            writes[`${P.participant(gameId, buzzerUid)}/correctAnswers`] = Number(pVal.correctAnswers || 0) + 1;
        }

        await update(ref(rtdb), writes);
        // Buzz queue and turn advance happen in Continue to Board.
    }

    if (refs.awardABtn) track(listen(refs.awardABtn, 'click', () => awardTeam(TEAM.A)));
    if (refs.awardBBtn) track(listen(refs.awardBBtn, 'click', () => awardTeam(TEAM.B)));

    if (refs.backToBoardBtn) {
        track(listen(refs.backToBoardBtn, 'click', async () => {
            if (!isGM) return;
            // Read the awarded team before clearing currentQuestion.
            // awardedTeam present → winner picks next; null → other team picks next.
            const awardedTeam = currentQuestion?.awardedTeam || null;
            await update(ref(rtdb, P.game(gameId)), {
                currentQuestion: null,
                swirlStartTime: null,
                swirlPaused: false
            });
            await clearBuzzQueue(gameId);
            await advanceTurn(gameId, awardedTeam);
        }));
    }

    // ─── Buzz button (non-GM) ──────────────────────────────────────────────────
    if (refs.buzzBtn) {
        track(listen(refs.buzzBtn, 'click', async () => {
            if (isGM) return;
            if (!currentQuestion || currentQuestion.showAnswer) return;
            if (swirlPausedByGM) return;        // reveal is paused — no buzzing until GM resumes
            if (meBuzzedThisQuestion) return;    // one buzz per player per question
            try {
                await enqueueBuzz(gameId);
            } catch (err) {
                console.error('Buzz failed:', err);
            }
        }));
    }

    // ─── Reflect answered/opened state on board tiles ──────────────────────────
    track(onValue(ref(rtdb, P.board(gameId)), (snap) => {
        snap.forEach((child) => {
            const tile = child.val();
            if (!tile?.id) return;
            const tileDiv = document.querySelector(`.tile[data-id="${tile.id}"]`);
            if (!tileDiv) return;

            if (tile.answered) {
                tileDiv.classList.add('answered');
                tileDiv.textContent = '✔';
                tileDiv.style.cursor = 'default';
            } else if (tile.opened) {
                tileDiv.classList.add('opened');
            }
        });
    }));

    // Board compact header is active from game load (the board is the starting view).
    setupBoardCompact();

    // ─── Dev-only finale shortcut ───────────────────────────────────────────────
    // Exercises the real RTDB end-game transition so all clients see the full
    // phase-listener → renderFinale path. Never available in production builds.
    if (import.meta.env.DEV && isGM) {
        window.ptDevEndGame = async () => {
            console.log('[dev] ptDevEndGame: writing phase=ended for game', gameId);
            try {
                const { endGame } = await import('./controllerKit.js');
                await endGame(gameId);
                console.log('[dev] ptDevEndGame: wrote phase=ended');
            } catch (err) {
                console.error('[dev] ptDevEndGame failed:', err);
            }
        };
        window.ptDevSetScores = async (scoreA, scoreB) => {
            console.log('[dev] ptDevSetScores:', scoreA, scoreB);
            try {
                await update(ref(rtdb, P.scores(gameId)), { A: Number(scoreA), B: Number(scoreB) });
            } catch (err) {
                console.error('[dev] ptDevSetScores failed:', err);
            }
        };
        console.log(
            '%c[Picture Twirl Dev] Available helpers:\n  ptDevEndGame()            — trigger End Game via RTDB\n  ptDevSetScores(A, B)      — set team scores',
            'color:#7C3AED;font-weight:bold'
        );
    }

}
