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
import { renderRoundSetup } from './renderRoundSetup.js';
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

    <!-- Players only: vote controls -->
    <p class="finale-play-q" data-ref="voteHeading">Play again?</p>
    <div class="finale-vote-row" data-ref="voteRow">
      <button class="btn ghost finale-vote-btn" data-ref="voteYes" aria-pressed="false">Yes</button>
      <button class="btn ghost finale-vote-btn" data-ref="voteNo" aria-pressed="false">No</button>
    </div>
    <div class="finale-vote-confirm" data-ref="voteConfirmMsg"></div>

    <!-- GM only: live vote summary + decision buttons -->
    <div class="finale-gm-summary" data-ref="gmVoteSummary"></div>
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

        if (isGM) {
            // GM sees: live vote summary + action buttons; no vote controls
            refs.voteHeading.hidden = true;
            refs.voteRow.hidden = true;
            refs.voteConfirmMsg.hidden = true;
            refs.gmVoteSummary.textContent = 'Waiting for player votes…';
            refs.gmActions.hidden = false;
        } else {
            // Players see: vote controls; no GM summary or action buttons
            refs.gmVoteSummary.hidden = true;
            refs.gmActions.hidden = true;
            // Pre-vote confirm line (applyVoteHighlight will keep this in sync)
            refs.voteConfirmMsg.textContent = 'You can change your vote.';
        }

        // ── Phase listener: roundSetup → round setup screen ──────────────────
        let unsubPhase = null;
        let unsubVotes = null;
        let myVote = null;

        // Applies selected state from a vote value ('yes' | 'no' | null).
        // Derives button text and confirmation message from persisted state so
        // the UI is correct after reload, reconnect, or any Firebase re-push.
        // Derived from persisted playAgainVote ('yes' | 'no' | null).
        // Only the is-voted class and aria-pressed toggle — button text stays fixed
        // so there is no layout shift and no emoji/checkmark juggling.
        function applyVoteHighlight(vote) {
            if (refs.voteYes) {
                const sel = vote === 'yes';
                refs.voteYes.classList.toggle('is-voted', sel);
                refs.voteYes.setAttribute('aria-pressed', String(sel));
                refs.voteYes.textContent = sel ? '✓ Yes' : 'Yes';
            }
            if (refs.voteNo) {
                const sel = vote === 'no';
                refs.voteNo.classList.toggle('is-voted', sel);
                refs.voteNo.setAttribute('aria-pressed', String(sel));
                refs.voteNo.textContent = sel ? '✓ No' : 'No';
            }
            if (refs.voteConfirmMsg) {
                refs.voteConfirmMsg.textContent = vote === 'yes' ? 'Your vote: Yes'
                    : vote === 'no' ? 'Your vote: No'
                    : 'You can change your vote.';
            }
        }

        unsubPhase = onValue(ref(rtdb, P.phase(gameId)), (snap) => {
            if (snap.val() === 'roundSetup') {
                cleanup();
                renderRoundSetup(gameId);
            }
        });

        unsubVotes = onValue(ref(rtdb, P.participants(gameId)), (snap) => {
            const parts = snap.val() || {};
            // GM is excluded from both numerator and denominator.
            let yes = 0, voted = 0, total = 0;
            for (const p of Object.values(parts)) {
                if (p.isGM) continue;
                total++;
                if (p.playAgainVote === 'yes') { yes++; voted++; }
                else if (p.playAgainVote === 'no') voted++;
            }

            // GM: show live vote summary
            if (isGM && refs.gmVoteSummary) {
                refs.gmVoteSummary.textContent = voted === 0
                    ? 'Waiting for player votes…'
                    : `${yes} of ${total} ${total === 1 ? 'player' : 'players'} want another round`;
            }

            // Players: sync own vote highlight from persisted state.
            // Covers initial load, reload, and any Firebase re-push.
            if (!isGM && myUid) {
                const persisted = parts[myUid]?.playAgainVote || null;
                myVote = persisted;
                applyVoteHighlight(persisted);
            }
        });

        async function castVote(vote) {
            if (!myUid || myVote === vote) return;
            // Optimistic: apply immediately for responsiveness before the round-trip
            myVote = vote;
            applyVoteHighlight(vote);
            await update(ref(rtdb, P.participant(gameId, myUid)), { playAgainVote: vote });
            // Firebase listener will re-confirm from persisted state shortly after
        }

        refs.voteYes?.addEventListener('click', () => castVote('yes'));
        refs.voteNo?.addEventListener('click', () => castVote('no'));

        // ── GM: Play Again ───────────────────────────────────────────────────
        if (isGM && refs.playAgainBtn) {
            refs.playAgainBtn.addEventListener('click', async () => {
                if (refs.playAgainBtn.dataset.busy === '1') return;
                refs.playAgainBtn.dataset.busy = '1';
                refs.playAgainBtn.disabled = true;
                if (refs.endSessionBtn) refs.endSessionBtn.disabled = true;
                try {
                    // Write roundSetup phase; phase listener navigates all clients
                    await update(ref(rtdb, P.state(gameId)), { phase: 'roundSetup' });
                } catch (err) {
                    console.error('[renderFinale] Play Again failed:', err);
                    refs.playAgainBtn.disabled = false;
                    if (refs.endSessionBtn) refs.endSessionBtn.disabled = false;
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

        function cleanup() {
            if (typeof unsubPhase === 'function') { unsubPhase(); unsubPhase = null; }
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
