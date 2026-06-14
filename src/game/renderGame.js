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
import { ref, onValue, update, get, serverTimestamp } from 'firebase/database';
import * as P from '../data/paths.js';
import { getSession } from '../session.js';
import { on as listen } from '../ui/dom.js';
import { attachCopyButton } from '../ui/copyButton.js';
import { mountTemplate, collectRefs } from '../ui/templates.js';
import { createBoard } from './createBoard.js';
import { startSwirlAnimation } from './swirl.js';
import { enqueueBuzz, clearBuzzQueue } from './buzz.js';
import { createDisposer, exitToHome, leaveGame, confirmEndGame, endGame } from './controllerKit.js';
import { initializeStartingTurn } from './turn.js';
import { escapeHtml } from '../ui/format.js';
import { TEAM, SWIRL, teamToAnswer } from '../config.js';

export async function renderGameUI(gameId) {
    const app = document.getElementById('app');
    const root = mountTemplate(app, 'tpl-game');
    const refs = collectRefs(root);

    const { isGM } = getSession();
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
    let currentTurn = null;       // { uid, team } — display only ("who is up")
    let selectedTile = null;      // { id, category, value } — GM has picked, not yet posted
    let currentQuestion = null;   // { id, category, imageUrl, value, showAnswer }
    let swirlStartTime = null;
    let swirlCtrl = null;
    let lastImageUrl = null;

    // ─── Copy code ─────────────────────────────────────────────────────────────
    track(attachCopyButton(refs.copyCodeBtn, () => gameId.toUpperCase()));

    // Clean up all RTDB listeners + swirl (defined early so handlers can reference it)
    function disposeAll() {
        disposeListeners();
        if (swirlCtrl?.cancel) swirlCtrl.cancel();
        swirlCtrl = null;
    }

    // ─── Tray exit links: wire BEFORE async work so they always attach ─────────
    if (refs.exitGameBtn) refs.exitGameBtn.hidden = !!isGM;
    if (refs.gmEndBtn) refs.gmEndBtn.hidden = !isGM;

    if (refs.exitGameBtn) {
        track(listen(refs.exitGameBtn, 'click', async (e) => {
            e?.preventDefault?.();
            if (isGM) return;
            await leaveGame(gameId, { uid: myUid, dispose: disposeAll });
        }));
    }

    if (refs.gmEndBtn) {
        track(listen(refs.gmEndBtn, 'click', async (e) => {
            e?.preventDefault?.();
            if (!isGM) return;
            if (refs.gmEndBtn.dataset.busy === '1') return;
            const res = await confirmEndGame();
            if (res !== 'confirm') return;
            refs.gmEndBtn.dataset.busy = '1';
            try {
                await endGame(gameId);
            } catch (err) {
                console.error('End failed', err);
                alert('Could not end the game.');
            } finally {
                refs.gmEndBtn.dataset.busy = '0';
            }
        }));
    }

    // ─── Phase listener: ended → everyone home ─────────────────────────────────
    track(onValue(ref(rtdb, P.phase(gameId)), (s) => {
        if (s.val() === 'ended') exitToHome(disposeAll);
    }));

    // ─── Title, teams, scores, participants ────────────────────────────────────
    track(onValue(ref(rtdb, P.title(gameId)), (s) => {
        refs.gameTitleEl.textContent = (s.val() || 'Picture Twirl').toString().trim();
    }));

    track(onValue(ref(rtdb, P.teams(gameId)), (s) => {
        teams = s.val() || teams;
        refs.teamAName.textContent = teams.A?.name || 'Team A';
        refs.teamBName.textContent = teams.B?.name || 'Team B';
    }));

    track(onValue(ref(rtdb, P.scores(gameId)), (s) => {
        const v = s.val() || {};
        scores = { A: Number(v.A || 0), B: Number(v.B || 0) };
        refs.teamAScore.textContent = scores.A;
        refs.teamBScore.textContent = scores.B;
    }));

    track(onValue(ref(rtdb, P.participants(gameId)), (s) => {
        participants = s.val() || {};
        updateActivePlayerDisplay();
    }));

    track(onValue(ref(rtdb, `${P.game(gameId)}/currentTurn`), (s) => {
        currentTurn = s.val();
        updateActivePlayerDisplay();
        updateStatusMessage();
    }));

    track(onValue(ref(rtdb, `${P.game(gameId)}/selectedTile`), (s) => {
        selectedTile = s.val();
        updateBoardSelection();
        updateStatusMessage();
        updateOkButton();
    }));

    // ─── Current question (drives the viewer) ──────────────────────────────────
    track(onValue(ref(rtdb, `${P.game(gameId)}/currentQuestion`), (s) => {
        currentQuestion = s.val();
        renderQuestionViewer();
        updateStatusMessage();
    }));

    track(onValue(ref(rtdb, `${P.game(gameId)}/swirlStartTime`), (s) => {
        swirlStartTime = typeof s.val() === 'number' ? s.val() : null;
    }));

    // ─── Buzz queue ────────────────────────────────────────────────────────────
    track(onValue(ref(rtdb, P.buzzQueue(gameId)), (s) => {
        const obj = s.val() || {};
        const ordered = Object.values(obj)
            .filter(e => e && typeof e.createdAt === 'number')
            .sort((a, b) => a.createdAt - b.createdAt);

        if (refs.buzzQueueEl) {
            refs.buzzQueueEl.innerHTML = ordered.length
                ? ordered.map(e => {
                    const name = participants?.[e.uid]?.displayName || 'Player';
                    return `<div class="buzz-entry">${escapeHtml(name)}</div>`;
                }).join('')
                : '';
        }

        // Pause swirl on first buzz
        if (ordered.length > 0 && swirlCtrl?.pause) {
            swirlCtrl.pause();
        }

        // Players: disable buzz button after they've buzzed
        if (refs.buzzBtn && !isGM) {
            const meBuzzed = ordered.some(e => e.uid === myUid);
            refs.buzzBtn.disabled = meBuzzed;
            refs.buzzBtn.textContent = meBuzzed ? 'BUZZED' : 'BUZZ IN';
        }
    }));

    // ─── Helpers ───────────────────────────────────────────────────────────────
    function updateActivePlayerDisplay() {
        if (!refs.teamAPlayer || !refs.teamBPlayer) return;
        refs.teamAPlayer.textContent = '';
        refs.teamBPlayer.textContent = '';

        if (!currentTurn) return;
        const player = participants[currentTurn.uid];
        if (!player) return;
        const name = (player.displayName || 'Player').toUpperCase();

        if (currentTurn.team === TEAM.A) refs.teamAPlayer.textContent = name;
        else if (currentTurn.team === TEAM.B) refs.teamBPlayer.textContent = name;
    }

    function updateStatusMessage() {
        if (!refs.statusMessage) return;

        if (currentQuestion) {
            const { category, value, showAnswer } = currentQuestion;
            refs.statusMessage.textContent = showAnswer
                ? `Answer revealed — ${category} for $${value}`
                : `${category} for $${value}`;
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
            const player = participants[currentTurn.uid];
            const name = player?.displayName || 'Player';
            refs.statusMessage.textContent = isGM
                ? `${name}'s turn — pick a tile`
                : `${name} is up`;
            return;
        }

        refs.statusMessage.textContent = 'Waiting for the next tile…';
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

    function renderQuestionViewer() {
        const active = !!currentQuestion;

        // Toggle board vs viewer
        if (refs.boardWrap) refs.boardWrap.hidden = active;
        if (refs.viewerEl) refs.viewerEl.hidden = !active;
        if (refs.okBtn) refs.okBtn.hidden = active || !isGM;

        // Buzz button: non-GM, only while question is active and answer not yet shown
        if (refs.buzzBtn) {
            refs.buzzBtn.hidden = isGM || !active || !!currentQuestion?.showAnswer;
        }

        // GM controls: only GM, only while question is active
        if (refs.gmControls) refs.gmControls.hidden = !isGM || !active;

        if (!active) {
            // Cancel swirl if running
            if (swirlCtrl?.cancel) swirlCtrl.cancel();
            swirlCtrl = null;
            lastImageUrl = null;
            if (refs.answerEl) {
                refs.answerEl.hidden = true;
                refs.answerEl.textContent = '';
            }
            return;
        }

        // Render question metadata
        if (refs.qCategory) refs.qCategory.textContent = currentQuestion.category || '';
        if (refs.qValue) refs.qValue.textContent = `$${currentQuestion.value ?? ''}`;

        // Load image and (re)start swirl when URL changes
        if (refs.twirlImage && currentQuestion.imageUrl && currentQuestion.imageUrl !== lastImageUrl) {
            refs.twirlImage.onload = () => {
                if (swirlCtrl?.cancel) swirlCtrl.cancel();
                const now = Date.now();
                const elapsed = swirlStartTime ? Math.max(0, now - swirlStartTime) : 0;
                swirlCtrl = startSwirlAnimation(
                    refs.twirlImage,
                    refs.twirlCanvas,
                    SWIRL.DURATION_MS,
                    SWIRL.STRENGTH,
                    elapsed
                );
            };
            refs.twirlImage.src = currentQuestion.imageUrl;
            lastImageUrl = currentQuestion.imageUrl;
        }

        // Answer display
        if (refs.answerEl) {
            if (currentQuestion.showAnswer) {
                refs.answerEl.textContent = currentQuestion.answer || '';
                refs.answerEl.hidden = false;
                if (swirlCtrl?.cancel) swirlCtrl.cancel();
            } else {
                refs.answerEl.hidden = true;
                refs.answerEl.textContent = '';
            }
        }
    }

    // ─── Initialize: pick a random starting player (GM only, once) ─────────────
    if (isGM) initializeStartingTurn(gameId);

    // ─── Board ─────────────────────────────────────────────────────────────────
    try {
        const boardEl = await createBoard(gameId, {
            onTileClick: async (tileData) => {
                if (!isGM) return;                  // GM-only
                if (currentQuestion) return;        // Question already active
                if (tileData.answered) return;
                await update(ref(rtdb, P.game(gameId)), {
                    selectedTile: {
                        id: tileData.id,
                        category: tileData.category,
                        value: tileData.value
                    }
                });
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

    // ─── GM controls: Show Answer / Award / Back to Board ──────────────────────
    if (refs.showAnswerBtn) {
        track(listen(refs.showAnswerBtn, 'click', async () => {
            if (!isGM || !currentQuestion) return;
            await update(ref(rtdb, P.currentQuestion(gameId)), { showAnswer: true });
        }));
    }

    async function awardTeam(teamKey) {
        if (!isGM || !currentQuestion?.id) return;
        const points = Number(currentQuestion.value || 0);
        const scorePath = P.score(gameId, teamKey);
        const tilePath = P.boardTile(gameId, currentQuestion.id);

        const scoreSnap = await get(ref(rtdb, scorePath));
        const curScore = scoreSnap.exists() ? Number(scoreSnap.val() || 0) : 0;

        await update(ref(rtdb), {
            [scorePath]: curScore + points,
            [`${tilePath}/answered`]: true,
            [`${tilePath}/answeredBy`]: teamToAnswer(teamKey),
            [`${tilePath}/awardedPoints`]: points,
            [`${tilePath}/lastActionAt`]: serverTimestamp(),
            [P.currentQuestion(gameId)]: null,
            [`${P.game(gameId)}/swirlStartTime`]: null
        });

        await clearBuzzQueue(gameId);
    }

    if (refs.awardABtn) track(listen(refs.awardABtn, 'click', () => awardTeam(TEAM.A)));
    if (refs.awardBBtn) track(listen(refs.awardBBtn, 'click', () => awardTeam(TEAM.B)));

    if (refs.backToBoardBtn) {
        track(listen(refs.backToBoardBtn, 'click', async () => {
            if (!isGM) return;
            await update(ref(rtdb, P.game(gameId)), {
                currentQuestion: null,
                swirlStartTime: null
            });
            await clearBuzzQueue(gameId);
        }));
    }

    // ─── Buzz button (non-GM) ──────────────────────────────────────────────────
    if (refs.buzzBtn) {
        track(listen(refs.buzzBtn, 'click', async () => {
            if (isGM) return;
            if (!currentQuestion || currentQuestion.showAnswer) return;
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

}
