// src/game/gmGameTour.js
// GM Running-the-Game coaching — Phase 2 (three contextual moments).
//
// Moments:
//   1 · boardIntro    — Board appears after coin flip; GM waits for active team to pick.
//   2 · adjudication  — First real buzz-pause: judgment principle (step 1 of 2).
//   3 · controls      — Same adjudication state: GM action controls (step 2 of 2).
//   4 · ending        — After the first question resolves; board is visible again.
//
// Called from renderGame.js (GM-only path). The caller drives all triggers;
// this module only orchestrates coach-mark display and persistence.

import { openGMTour } from '../ui/gmTour.js';
import {
    shouldShowBoardIntro,    markBoardIntroComplete,
    shouldShowAdjudication,  markAdjudicationComplete,
    shouldShowEnding,        markEndingComplete,
    dismissGMOnboarding,
} from './gmOnboarding.js';

/**
 * Initialise Running-the-Game tour orchestration.
 *
 * @param {object}   refs     - collectRefs() output from renderGame.js.
 *                              Uses: statusMessage, gmControls, gmEndBtn, gameMain.
 * @param {Element}  root     - Game template root element (applied as blockRoot so
 *                              the underlying game UI is non-interactive during coaching).
 * @param {function} getState - Getter that returns current live game state:
 *                              { boardLocked, currentQuestion, selectedTile,
 *                                activeBuzzerUid, swirlPausedByGM }
 * @returns {{ onBoardUnlocked, onBuzzAdjudicating, onQuestionResolved,
 *             onGameStateChanged, dispose }}
 */
export function initGMGameTour(refs, root, getState) {
    // Session-level trigger guards — prevent double-firing within a game session.
    let moment1Triggered  = false;
    let moment23Triggered = false; // reset if tour is interrupted before completion
    let moment4Triggered  = false;
    let moment4Pending    = false; // true while the 300ms settle timer is running

    // Which moment is currently showing (null when none are open).
    let currentlyShowing = null; // 'boardIntro' | 'adjudication' | 'ending' | null
    let activeTourClose  = null; // close() returned by openGMTour

    // Close whatever is open, without marking any persistence.
    function safeClose() {
        if (activeTourClose) { activeTourClose(); activeTourClose = null; }
        currentlyShowing = null;
    }

    // ── Moment 1: "Let the team choose" ──────────────────────────────────────
    // Trigger: called from showCoinFlip's cleanup callback — the deterministic
    // lifecycle point where boardLocked becomes false and the board is open.
    function onBoardUnlocked() {
        if (moment1Triggered) return;
        if (!shouldShowBoardIntro()) return;

        const { currentQuestion, selectedTile } = getState();
        if (currentQuestion || selectedTile) return; // game already advanced past this state

        const targetEl = refs.statusMessage;
        if (!targetEl || !document.contains(targetEl)) return;

        moment1Triggered  = true;
        currentlyShowing  = 'boardIntro';

        activeTourClose = openGMTour({
            steps: [{
                targetEl,
                title: 'Let the team choose',
                body:  'The active team picks the picture. You\'ll be notified when their choice is ready to reveal.',
            }],
            scrollContainer: refs.gameMain,
            blockRoot:       root,
            alwaysShowSkip:  true,
            onComplete: () => {
                markBoardIntroComplete();
                currentlyShowing = null;
                activeTourClose  = null;
            },
            onSkip: () => {
                dismissGMOnboarding();
                currentlyShowing = null;
                activeTourClose  = null;
            },
        });
    }

    // ── Moments 2 + 3: adjudication coaching (2-step sequence) ───────────────
    // Trigger: called from the swirlPaused RTDB listener when
    // swirlPausedByGM === true AND activeBuzzerUid !== null.
    // This condition distinguishes a real buzz-induced pause from a manual GM pause.
    //
    // Interrupted before step 2 → moment23Triggered resets → retries on next real buzz.
    // Completed (Got it on step 2) → markAdjudicationComplete() → never shows again.
    function onBuzzAdjudicating() {
        if (moment23Triggered) return;
        if (!shouldShowAdjudication()) return;

        const { currentQuestion, swirlPausedByGM, activeBuzzerUid } = getState();
        if (!currentQuestion || !swirlPausedByGM || !activeBuzzerUid) return;

        const adjTarget  = refs.statusMessage;
        const ctrlTarget = refs.gmControls;
        if (!adjTarget  || !document.contains(adjTarget))  return;
        if (!ctrlTarget || !document.contains(ctrlTarget)) return;

        safeClose();
        moment23Triggered = true;
        currentlyShowing  = 'adjudication';

        activeTourClose = openGMTour({
            steps: [
                {
                    targetEl: adjTarget,
                    title:    'You make the call',
                    body:     'Answers don\'t have to be word-for-word. If the guess clearly identifies the answer, it can count. Use the same standard for both teams.',
                },
                {
                    targetEl: ctrlTarget,
                    title:    'Keep things moving',
                    body:     'Correct? Award it. Wrong? Resume the reveal. If a player goes quiet, give them a moment. If play stalls, reveal the answer and move on without points.',
                },
            ],
            scrollContainer: refs.gameMain,
            blockRoot:       root,
            alwaysShowSkip:  true,
            onComplete: () => {
                markAdjudicationComplete();
                // moment23Triggered stays true — sequence is done, do not retrigger.
                currentlyShowing = null;
                activeTourClose  = null;
            },
            onSkip: () => {
                dismissGMOnboarding();
                // moment23Triggered stays true — GM dismissed all future coaching.
                currentlyShowing = null;
                activeTourClose  = null;
            },
        });
    }

    // ── Moment 4: "End when you need to" ─────────────────────────────────────
    // Trigger: called from backToBoardBtn handler after any question resolution
    // (award OR reveal-without-points). A 300ms settle gives the board transition
    // time to complete before measuring gmEndBtn's position.
    function onQuestionResolved() {
        if (moment4Triggered) return;
        if (!shouldShowEnding()) return;
        if (moment4Pending) return; // coalesce rapid calls into one timer

        moment4Pending = true;

        setTimeout(() => {
            moment4Pending = false;

            if (moment4Triggered) return;
            if (!shouldShowEnding()) return;

            const { currentQuestion } = getState();
            if (currentQuestion) return; // a new question started in the settle window; retry next time

            const targetEl = refs.gmEndBtn;
            if (!targetEl || !document.contains(targetEl) || targetEl.hidden) return;

            safeClose();
            moment4Triggered = true;
            currentlyShowing = 'ending';

            activeTourClose = openGMTour({
                steps: [{
                    targetEl,
                    title: 'End when you need to',
                    body:  'Finish the board or wrap up early. Either way, Picture Twirl still shows the finale.',
                }],
                scrollContainer: refs.gameMain,
                blockRoot:       root,
                alwaysShowSkip:  true,
                onComplete: () => {
                    markEndingComplete();
                    currentlyShowing = null;
                    activeTourClose  = null;
                },
                onSkip: () => {
                    dismissGMOnboarding();
                    currentlyShowing = null;
                    activeTourClose  = null;
                },
            });
        }, 300);
    }

    // ── State-change safety guard ─────────────────────────────────────────────
    // Called from renderGame.js when currentQuestion, selectedTile, or swirlPaused
    // change. Closes any coaching whose required game state is no longer valid.
    function onGameStateChanged() {
        if (!activeTourClose || !currentlyShowing) return;

        const { currentQuestion, swirlPausedByGM, activeBuzzerUid, selectedTile } = getState();

        if (currentlyShowing === 'boardIntro') {
            // Close if the game moved past the "waiting for team to pick" state.
            if (currentQuestion || selectedTile) safeClose();
        }

        if (currentlyShowing === 'adjudication') {
            // Close if adjudication is no longer active (Resume, Award, or question end).
            if (!swirlPausedByGM || !activeBuzzerUid || !currentQuestion) {
                safeClose();
                // Reset so it can fire again on the NEXT real buzz.
                // adjudicationSeen is only marked in onComplete, so it stays unseen.
                moment23Triggered = false;
            }
        }

        if (currentlyShowing === 'ending') {
            // Close if a new question has started.
            if (currentQuestion) safeClose();
        }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    // Called from renderGame.js disposeAll (e.g., phase changes to 'ended').
    function dispose() {
        safeClose();
    }

    return { onBoardUnlocked, onBuzzAdjudicating, onQuestionResolved, onGameStateChanged, dispose };
}
