// src/game/renderFinale.js
//
// End-game finale experience: Winner Reveal → Scores → MVP → Play Again CTA.
// Replaces the game/lobby view when state.phase becomes 'ended'.
// GM controls Play Again / End Session; players cast a yes/no vote.

import { rtdb, getCurrentUser } from '../firebase.js';
import { ref, onValue, get, update, serverTimestamp } from 'firebase/database';
import * as P from '../data/paths.js';
import { getSession, setSession } from '../session.js';
import { collectRefs } from '../ui/templates.js';
import { escapeHtml } from '../ui/format.js';
import { burstCelebration } from '../ui/confetti.js';
import { playVictory } from '../ui/sound.js';
import { renderLobby } from './lobby.js';
import { createGameShell } from './createGame.js';
import { TEAM } from '../config.js';

// Phase timings (ms from endedAt server timestamp)
const PHASE_WINNER = 350;
const PHASE_SCORES = 2600;
const PHASE_MVP    = 5400;
const PHASE_CTA    = 8000;

export async function renderFinale(gameId, { teamAIcon = '🐕', teamBIcon = '🐈', dispose = null } = {}) {
    // Tear down the previous controller's listeners
    if (typeof dispose === 'function') dispose();

    const app = document.getElementById('app');
    const { isGM, displayName } = getSession();
    const user = getCurrentUser();
    const myUid = user?.uid || null;

    // ── Clear the old UI immediately so the board never appears "stuck" ──────
    // Any error after this point shows an explicit fallback rather than a frozen board.
    app.innerHTML = '';

    try {
        // ── Fetch game data ──────────────────────────────────────────────────
        // NOTE: .info/serverTimeOffset is NOT readable via get() — it is a special
        // virtual path that only works with onValue(). Omit it here; the game was
        // just ended so the elapsed time since endedAt is negligible, and defaulting
        // serverOffset to 0 is safe for the phase-timing calculation.
        const [stateSnap, teamsSnap, scoresSnap, participantsSnap, titleSnap, settingsSnap] =
            await Promise.all([
                get(ref(rtdb, P.state(gameId))),
                get(ref(rtdb, P.teams(gameId))),
                get(ref(rtdb, P.scores(gameId))),
                get(ref(rtdb, P.participants(gameId))),
                get(ref(rtdb, P.title(gameId))),
                get(ref(rtdb, P.settings(gameId))),
            ]);

        const stateVal      = stateSnap.val() || {};
        const teams         = teamsSnap.val() || { A: { name: 'Team A' }, B: { name: 'Team B' } };
        const rawScores     = scoresSnap.val() || {};
        const participants  = participantsSnap.val() || {};
        const gameTitle     = (titleSnap.val() || 'Picture Twirl').toString().trim();
        const settings      = settingsSnap.val() || {};

        const scores = { A: Number(rawScores.A || 0), B: Number(rawScores.B || 0) };

        // Elapsed time since game ended. serverOffset=0 is safe here: the phase
        // listener fires almost immediately after endGame() writes, so elapsed ≈ 0
        // and all animation phases will run on their normal schedule.
        const endedAt = typeof stateVal.endedAt === 'number' ? stateVal.endedAt : null;
        const elapsed = endedAt ? Math.max(0, Date.now() - endedAt) : 0;

        // ── Winner logic ─────────────────────────────────────────────────────
        const tie = scores.A === scores.B;
        const winner = tie ? null : (scores.A > scores.B ? TEAM.A : TEAM.B);
        const teamAName = tc(teams.A?.name || 'Team A');
        const teamBName = tc(teams.B?.name || 'Team B');
        const winnerName = winner === TEAM.A ? teamAName : (winner === TEAM.B ? teamBName : null);

        // ── MVP ──────────────────────────────────────────────────────────────
        const mvp = computeMvp(participants);

        // ── Build DOM ────────────────────────────────────────────────────────
        app.innerHTML = `
<div class="finale-root${isGM ? ' is-gm' : ''}">

  <section class="finale-s finale-s--winner" data-ref="sWinner">
    <div class="finale-glow"></div>
    <div class="finale-icon" data-ref="winnerIcon"></div>
    <div class="finale-team-name" data-ref="winnerTeam"></div>
    <div class="finale-badge" data-ref="winnerBadge"></div>
  </section>

  <section class="finale-s finale-s--scores" data-ref="sScores">
    <div class="finale-scoreboard" data-ref="scoreboard"></div>
    <div class="finale-tagline">What a game!</div>
  </section>

  <section class="finale-s finale-s--mvp" data-ref="sMvp">
    <div class="finale-mvp-trophy">🏆</div>
    <div class="finale-mvp-label">Picture Twirl MVP</div>
    <div class="finale-mvp-name" data-ref="mvpName"></div>
    <div class="finale-mvp-stats" data-ref="mvpStats"></div>
    <div class="finale-mvp-team" data-ref="mvpTeam"></div>
  </section>

  <section class="finale-s finale-s--cta" data-ref="sCta">
    <div class="finale-cta-title" data-ref="ctaTitle"></div>
    <p class="finale-play-q">Play again?</p>
    <div class="finale-vote-row">
      <button class="btn secondary finale-vote-btn" data-ref="voteYes">👍 Yes</button>
      <button class="btn ghost finale-vote-btn" data-ref="voteNo">👎 No</button>
    </div>
    <div class="finale-vote-tally" data-ref="voteTally" hidden></div>
    <div class="finale-gm-actions" data-ref="gmActions" hidden>
      <button class="btn primary" data-ref="playAgainBtn">Play Again</button>
      <button class="btn ghost" data-ref="endSessionBtn">End Session</button>
    </div>
  </section>

</div>`;

        const root = app.firstElementChild;
        const refs = collectRefs(root);

        // ── Winner section ───────────────────────────────────────────────────
        if (tie) {
            refs.winnerIcon.textContent = '🤝';
            refs.winnerTeam.textContent = "It's a tie!";
            refs.winnerBadge.textContent = 'Amazing game';
            refs.winnerBadge.classList.add('is-tie');
            root.style.setProperty('--finale-hue', '#7C3AED');
        } else {
            refs.winnerIcon.textContent = winner === TEAM.A ? teamAIcon : teamBIcon;
            refs.winnerTeam.textContent = winnerName;
            refs.winnerBadge.textContent = 'Winner!';
            root.style.setProperty('--finale-hue', winner === TEAM.A ? '#7C3AED' : '#06B6D4');
        }

        // ── Scores section ───────────────────────────────────────────────────
        refs.scoreboard.innerHTML =
            `<div class="finale-score-row${winner === TEAM.A ? ' is-winner' : ''}">
                <span class="fsr-name">${escapeHtml(teamAName)}</span>
                <span class="fsr-val">${scores.A.toLocaleString()}</span>
            </div>
            <div class="finale-score-row${winner === TEAM.B ? ' is-winner' : ''}">
                <span class="fsr-name">${escapeHtml(teamBName)}</span>
                <span class="fsr-val">${scores.B.toLocaleString()}</span>
            </div>`;

        // ── MVP section ──────────────────────────────────────────────────────
        if (mvp) {
            refs.mvpName.textContent = mvp.displayName.toUpperCase();
            refs.mvpStats.textContent = `${mvp.pointsEarned.toLocaleString()} pts · ${mvp.correctAnswers} ${mvp.correctAnswers === 1 ? 'solve' : 'solves'}`;
            const mvpTeamName = mvp.team && mvp.team !== TEAM.NONE
                ? tc(teams[mvp.team]?.name || `Team ${mvp.team}`) : null;
            if (mvpTeamName) {
                refs.mvpTeam.textContent = mvpTeamName;
            } else {
                refs.mvpTeam.hidden = true;
            }
        } else {
            refs.sMvp.hidden = true;
        }

        // ── CTA section ──────────────────────────────────────────────────────
        refs.ctaTitle.textContent = gameTitle ? `Thanks for playing ${gameTitle}!` : 'Thanks for playing!';
        if (isGM) refs.gmActions.hidden = false;

        // ── Vote listener ────────────────────────────────────────────────────
        let unsubVotes = null;
        let myVote = null;

        unsubVotes = onValue(ref(rtdb, P.participants(gameId)), (snap) => {
            const parts = snap.val() || {};
            let yes = 0, total = 0;
            for (const p of Object.values(parts)) {
                if (p.isGM) continue;
                total++;
                if (p.playAgainVote === 'yes') yes++;
            }
            if (isGM && refs.voteTally) {
                refs.voteTally.textContent = total > 0
                    ? `${yes} of ${total} ${total === 1 ? 'player' : 'players'} want another round` : '';
                refs.voteTally.hidden = total === 0;
            }
        });

        function applyVoteHighlight(vote) {
            refs.voteYes?.classList.toggle('is-voted', vote === 'yes');
            refs.voteNo?.classList.toggle('is-voted', vote === 'no');
        }

        async function castVote(vote) {
            if (!myUid || myVote === vote) return;
            myVote = vote;
            applyVoteHighlight(vote);
            await update(ref(rtdb, P.participant(gameId, myUid)), { playAgainVote: vote });
        }

        refs.voteYes?.addEventListener('click', () => castVote('yes'));
        refs.voteNo?.addEventListener('click', () => castVote('no'));

        // ── GM: Play Again ───────────────────────────────────────────────────
        if (isGM && refs.playAgainBtn) {
            refs.playAgainBtn.addEventListener('click', async () => {
                if (refs.playAgainBtn.dataset.busy === '1') return;
                refs.playAgainBtn.dataset.busy = '1';
                refs.playAgainBtn.disabled = true;
                refs.endSessionBtn.disabled = true;

                try {
                    const newGameId = Math.random().toString(36).substring(2, 8);

                    await createGameShell(newGameId, {
                        setId: settings.setId,
                        teamA: teams.A?.name,
                        teamB: teams.B?.name,
                        gmName: displayName,
                        title: gameTitle,
                        teamsEnabled: settings.teamsEnabled,
                    });

                    // Pre-populate participants with preserved teams
                    const writes = {};
                    for (const [uid, p] of Object.entries(participants)) {
                        writes[P.participant(newGameId, uid)] = {
                            displayName: p.displayName || 'Player',
                            team: p.team || TEAM.NONE,
                            joinedAt: serverTimestamp(),
                            isGM: !!p.isGM,
                        };
                    }
                    if (Object.keys(writes).length) await update(ref(rtdb), writes);

                    // Signal all clients (must happen after new game exists)
                    await update(ref(rtdb, P.state(gameId)), { rematchGameId: newGameId });

                    // GM navigates
                    cleanup();
                    setSession({ gameId: newGameId, isGM: true, displayName });
                    renderLobby(newGameId);
                } catch (err) {
                    console.error('[renderFinale] Play Again failed:', err);
                    refs.playAgainBtn.disabled = false;
                    refs.endSessionBtn.disabled = false;
                    refs.playAgainBtn.dataset.busy = '0';
                }
            });
        }

        // ── GM: End Session ──────────────────────────────────────────────────
        if (isGM && refs.endSessionBtn) {
            refs.endSessionBtn.addEventListener('click', () => {
                cleanup();
                setSession({ gameId: null, isGM: false });
                window.location.reload();
            });
        }

        // ── Players: watch for rematch ───────────────────────────────────────
        if (!isGM) {
            const unsubRematch = onValue(ref(rtdb, `${P.state(gameId)}/rematchGameId`), (snap) => {
                const newId = snap.val();
                if (!newId) return;
                unsubRematch();
                cleanup();
                setSession({ gameId: newId, isGM: false, displayName });
                renderLobby(newId);
            });
        }

        function cleanup() {
            if (typeof unsubVotes === 'function') { unsubVotes(); unsubVotes = null; }
        }

        // ── Animation sequence ───────────────────────────────────────────────
        function showAt(selector, delay) {
            const ms = Math.max(0, delay - elapsed);
            setTimeout(() => {
                const el = root.querySelector(selector);
                if (el) { el.removeAttribute('hidden'); el.classList.add('is-visible'); }
            }, ms);
        }

        // Winner section is always shown first
        refs.sWinner.classList.add('is-visible');

        // Confetti + sound fires shortly after winner appears
        if (elapsed < PHASE_SCORES) {
            const celebMs = Math.max(0, PHASE_WINNER + 250 - elapsed);
            setTimeout(() => {
                playVictory();
                burstCelebration(tie ? 0.5 : (winner === TEAM.A ? 0.35 : 0.65));
            }, celebMs);
        }

        showAt('.finale-s--scores', PHASE_SCORES);
        if (mvp) showAt('.finale-s--mvp', PHASE_MVP);
        showAt('.finale-s--cta', PHASE_CTA);

    } catch (err) {
        console.error('[renderFinale] Failed to render finale:', err);
        // Show a minimal fallback so the app isn't stuck on a blank screen
        app.innerHTML = `
<div class="finale-root">
  <section class="finale-s finale-s--winner is-visible">
    <div class="finale-icon">🏁</div>
    <div class="finale-team-name">Game Over</div>
    <div class="finale-badge">Thanks for playing!</div>
  </section>
  <section class="finale-s finale-s--cta is-visible">
    <button class="btn primary" onclick="window.location.reload()">Go Home</button>
  </section>
</div>`;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeMvp(participants) {
    let best = null;
    for (const p of Object.values(participants)) {
        if (p.isGM) continue;
        const pts = Number(p.pointsEarned || 0);
        const solves = Number(p.correctAnswers || 0);
        if (pts <= 0 && solves <= 0) continue;
        if (!best || pts > best.pointsEarned || (pts === best.pointsEarned && solves > best.correctAnswers)) {
            best = { displayName: p.displayName || 'Player', team: p.team, pointsEarned: pts, correctAnswers: solves };
        }
    }
    return best;
}

function tc(str) {
    return str ? str.replace(/\b\w/g, c => c.toUpperCase()) : str;
}
