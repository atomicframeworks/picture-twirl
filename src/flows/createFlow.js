// src/flows/createFlow.js
//
// Create Game — 3-step flow (Details → Pick a Board → Game Ready)
// -----------------------------------------------------------------------------
// Step 1:
//   - Validate GM name, Game name, (optional) team names.
//   - "Next" enabled only when valid.
// Step 2:
//   - Scrollable list of published boards (from /api/boards, via
//     ui/boardPicker.js) with fixed header + bottom tray.
//   - "Next" enabled only when a board is selected.
// On final Next:
//   - requireAuth()
//   - createGameShell()
//   - Show Game Ready screen
// Game Ready screen:
//   - Display game code with share functionality
//   - "Go to Lobby" → renderLobby()
//   - "End game" → delete game and return home
//
// Notes:
// - Null-safe DOM access throughout.
// - Uses shared .actions-tray styles from main.css.
// -----------------------------------------------------------------------------

import { on, enable, disable } from '../ui/dom.js';
import { flashCheckmark } from '../ui/copyButton.js';
import { attachDiceButton } from '../ui/diceButton.js';
import { mountBoardPicker } from '../ui/boardPicker.js';
import { LIMITS } from '../config.js';
import { randomGameName, randomPlayerName, randomTeamName } from '../names.js';
import {
    resolvePlayerName,
    savePlayerName,
    resolveGameName,
    saveGameName,
    resolveTeamNames,
    saveTeamName,
} from '../prefs.js';
import { rtdb } from '../realtime/client.js';
import { ref, remove } from '../realtime/db.js';
import * as P from '../data/paths.js';
import { modal } from '../ui/modal.js';
import { capture } from '../analytics.js';
import { generateId } from '../game/analyticsIds.js';

export function initCreateFlow({ services, els }) {
    const {
        requireAuth,
        createGameShell,
        renderLobby,
        setSession,
        showView,
        generateGameId,
        reserveGameCode,   // the real, collision-free code (server-side, AUDIT M4)
        // Injectable for tests; defaults to the real analytics capture.
        capture: doCapture = capture,
        // Injectable mock board picker for tests (bypasses mountBoardPicker + DOM).
        boardPicker: pickerOverride = null,
        // Injectable for tests; defaults to the modal.confirm() call below.
        confirmDelete: confirmDeleteFn = null,
        // Injectable for tests; defaults to the RTDB remove() call below.
        removeGame: removeGameFn = null,
    } = services;

    const {
        // Step 1 elements
        createGameForm,
        gmNameInput,
        gameNameInput,
        teamANameInput,
        teamBNameInput,
        gmNameRollBtn,
        gameNameRollBtn,
        teamARollBtn,
        teamBRollBtn,

        // Step 2 elements
        step1Root,
        step2Root,
        step1NextBtn,
        step1ExitBtn,
        step2BackBtn,
        step2NextBtn,
        setListEl,
        headerTitleEl,

        // Game Ready screen elements
        readyGameTitle,
        readyGameCode,
        shareCodeBtn,
        goToLobbyBtn,
        endGameFromReadyBtn,
        callReminderEl,
        callReminderDismiss,
    } = els;

    // Internal state
    let currentGameId = null;
    let attemptId = null;       // stable ID across all 4 analytics events for one attempt
    let attemptOrigin = null;   // 'new' | 'play_again'
    let attemptBoardMeta = null; // { boardId, boardRev } set at step-2 commit
    let attemptGameMeta = null;  // { analyticsId, roundId } set after successful creation
    let isBusy = false;          // prevents double-creates from rapid clicks
    let reminderDismissed = false; // reset for each new game
    const teamsOn = true; // Teams are always enabled in this version

    // Step 2 board list (loads from the API each time step 2 opens)
    const mountedPicker = setListEl
        ? mountBoardPicker(setListEl, { onChange: () => updateStep2NextEnabled() })
        : null;
    const pickerToUse = pickerOverride ?? mountedPicker;

    // Default delete helpers — overridable for testing.
    const doConfirmDelete = confirmDeleteFn ?? (() => modal.confirm({
        title: 'End game?',
        body: 'This will delete the game. You can\'t undo this.',
        confirmText: 'End game',
        variant: 'danger',
    }));
    const doRemoveGame = removeGameFn ?? ((id) => remove(ref(rtdb, P.game(id))));

    // ───────────────────────────────────────────────────────────────────────────
    // Helpers
    // ───────────────────────────────────────────────────────────────────────────

    function isStep1Valid() {
        const gmOk = !!(gmNameInput && gmNameInput.value.trim());
        const gameOk = !!(gameNameInput && gameNameInput.value.trim());
        const aOk = !!(teamANameInput && teamANameInput.value.trim());
        const bOk = !!(teamBNameInput && teamBNameInput.value.trim());
        return gmOk && gameOk && aOk && bOk;
    }

    function isStep2Valid() {
        return !!pickerToUse?.getSelected();
    }

    function updateStep1NextEnabled() {
        (isStep1Valid() ? enable : disable)(step1NextBtn);
    }

    function updateStep2NextEnabled() {
        (isStep2Valid() ? enable : disable)(step2NextBtn);
    }

    function gotoStep(step) {
        if (step1Root) step1Root.hidden = (step !== 1);
        if (step2Root) step2Root.hidden = (step !== 2);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Name suggestions (Step 1)
    // - Every name field is never blank: remembered from a previous game on this
    //   device, or freshly generated (and then remembered).
    // - form.reset() wipes JS-assigned values, so prefill always follows a reset.
    // ───────────────────────────────────────────────────────────────────────────

    function prefillNames() {
        if (gmNameInput) gmNameInput.value = resolvePlayerName();
        if (gameNameInput) gameNameInput.value = resolveGameName();

        const [teamA, teamB] = resolveTeamNames();
        if (teamANameInput) teamANameInput.value = teamA;
        if (teamBNameInput) teamBNameInput.value = teamB;
    }

    /** Roll a new screen name (never the one already shown) and remember it. */
    function rollPlayerName() {
        if (!gmNameInput) return;

        const next = randomPlayerName([gmNameInput.value]).slice(0, LIMITS.DISPLAY_NAME);
        gmNameInput.value = next;
        savePlayerName(next);
        updateStep1NextEnabled();
    }

    /** Roll a new game title (never the one already shown) and remember it. */
    function rollGameName() {
        if (!gameNameInput) return;

        const next = randomGameName([gameNameInput.value]).slice(0, LIMITS.GAME_TITLE);
        gameNameInput.value = next;
        saveGameName(next);
        updateStep1NextEnabled();
    }

    /**
     * Roll a new name for one team: never the name it already shows, never the
     * other team's name. Remembered immediately so a good roll survives.
     * @param {'A'|'B'} teamKey
     */
    function rollTeamName(teamKey) {
        const input = teamKey === 'A' ? teamANameInput : teamBNameInput;
        const other = teamKey === 'A' ? teamBNameInput : teamANameInput;
        if (!input) return;

        const next = randomTeamName([input.value, other?.value]).slice(0, LIMITS.TEAM_NAME);
        input.value = next;
        saveTeamName(teamKey, next);
        updateStep1NextEnabled();
    }

    /** Remember whatever the user settled on, so it greets them next time. */
    function rememberStep1Names() {
        savePlayerName(gmNameInput?.value || '');
        saveGameName(gameNameInput?.value || '');
        saveTeamName('A', teamANameInput?.value || '');
        saveTeamName('B', teamBNameInput?.value || '');
    }

    function resetCreate() {
        createGameForm?.reset?.();
        prefillNames();
        pickerToUse?.reset();
        updateStep1NextEnabled();
        updateStep2NextEnabled();
        if (headerTitleEl) headerTitleEl.textContent = '';
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Live validation & events
    // ───────────────────────────────────────────────────────────────────────────
    if (createGameForm) ['input', 'change'].forEach(evt =>
        on(createGameForm, evt, updateStep1NextEnabled, true)
    );

    // Remember edited names on commit (change fires on blur / before button clicks)
    on(gmNameInput, 'change', () => savePlayerName(gmNameInput?.value || ''));
    on(gameNameInput, 'change', () => saveGameName(gameNameInput?.value || ''));
    on(teamANameInput, 'change', () => saveTeamName('A', teamANameInput?.value || ''));
    on(teamBNameInput, 'change', () => saveTeamName('B', teamBNameInput?.value || ''));

    // Dice: roll a fresh name (spin animation handled by the shared helper)
    attachDiceButton(gmNameRollBtn, rollPlayerName);
    attachDiceButton(gameNameRollBtn, rollGameName);
    attachDiceButton(teamARollBtn, () => rollTeamName('A'));
    attachDiceButton(teamBRollBtn, () => rollTeamName('B'));

    // Step 1: Form submit handler (Enter key support)
    on(createGameForm, 'submit', (e) => {
        e.preventDefault();
        if (!step1Root?.hidden && isStep1Valid()) {
            step1NextBtn?.click();
        }
    });

    // Step 1: Also listen for Enter key directly on the form
    on(createGameForm, 'keydown', (e) => {
        // Let Enter activate an in-form button (the dice) instead of advancing.
        if (e.target?.tagName === 'BUTTON') return;
        if (e.key === 'Enter' && !step1Root?.hidden && isStep1Valid()) {
            e.preventDefault();
            step1NextBtn?.click();
        }
    });

    // Step 1 Next
    on(step1NextBtn, 'click', async (e) => {
        e.preventDefault();
        if (!isStep1Valid()) return;

        rememberStep1Names();

        const gmDisplayName = (gmNameInput?.value || '').trim().slice(0, LIMITS.DISPLAY_NAME);
        const gameDisplayName = (gameNameInput?.value || '').trim().slice(0, LIMITS.GAME_TITLE);
        setSession({ displayName: gmDisplayName, isGM: true });

        // Update the header for Step 2 (title = game name)
        if (headerTitleEl) headerTitleEl.textContent = gameDisplayName || 'Picture Twirl';

        // Load the published boards (Next stays disabled until one is picked)
        pickerToUse?.load();
        updateStep2NextEnabled();
        gotoStep(2);
    });

    // Step 1 Exit
    on(step1ExitBtn, 'click', (e) => {
        e.preventDefault();
        resetCreate();
        showView('home');
    });

    // Step 2 Back
    on(step2BackBtn, 'click', (e) => {
        e.preventDefault();
        gotoStep(1);
        updateStep1NextEnabled();
    });

    // Step 2: Enter key support
    on(step2Root, 'keydown', (e) => {
        if (e.key === 'Enter' && !step2Root?.hidden && isStep2Valid() && !step2NextBtn?.disabled) {
            e.preventDefault();
            step2NextBtn?.click();
        }
    });

    // Step 2 Next (finalize → create → show Game Ready)
    on(step2NextBtn, 'click', async (e) => {
        e.preventDefault();
        if (!isStep2Valid() || isBusy) return;
        isBusy = true;

        // Capture board selection synchronously (before any await) so it's
        // guaranteed to fire even if creation later fails.
        const board = pickerToUse.getSelected();
        const boardId = board?.slug ?? board?.id ?? null;
        const boardRev = board?.rev ?? null;
        attemptBoardMeta = { boardId, boardRev };

        doCapture('pt_board_selected', {
            create_attempt_id: attemptId,
            board_id: boardId,
            board_version: boardRev,
            role: 'gm',
            origin: attemptOrigin,
        });

        try {
            await requireAuth(); // ensure auth.uid exists

            // The server hands out a code no live game is using (replaces the
            // placeholder from startCreateFlow; a collision used to overwrite a game).
            if (reserveGameCode) {
                currentGameId = await reserveGameCode();
                setSession({ gameId: currentGameId, isGM: true });
            }

            const gmDisplayName = (gmNameInput?.value || '').trim().slice(0, LIMITS.DISPLAY_NAME);
            const gameDisplayName = (gameNameInput?.value || '').trim().slice(0, LIMITS.GAME_TITLE);
            const teamA = teamsOn ? (teamANameInput?.value?.trim() || 'Team A') : '';
            const teamB = teamsOn ? (teamBNameInput?.value?.trim() || 'Team B') : '';

            setSession({ displayName: gmDisplayName, isGM: true });

            const created = await createGameShell(currentGameId, {
                boardId: pickerToUse.getSelected().id,
                title: gameDisplayName,
                gmName: gmDisplayName,
                teamsEnabled: teamsOn,
                teamA,
                teamB,
            });

            attemptGameMeta = created
                ? { analyticsId: created.analyticsId, roundId: created.roundId }
                : null;

            doCapture('pt_game_created', {
                create_attempt_id: attemptId,
                game_session_id: attemptGameMeta?.analyticsId ?? undefined,
                round_id: attemptGameMeta?.roundId ?? undefined,
                board_id: attemptBoardMeta?.boardId ?? undefined,
                board_version: attemptBoardMeta?.boardRev ?? undefined,
                role: 'gm',
                origin: attemptOrigin,
            });

            // Show Game Ready screen
            if (readyGameTitle) readyGameTitle.textContent = gameDisplayName;
            if (readyGameCode) readyGameCode.textContent = currentGameId.toUpperCase();
            reminderDismissed = false;
            if (callReminderEl) callReminderEl.hidden = false;
            showView('gameReady');
            // Focus the "Go to Lobby" button so Enter works naturally
            goToLobbyBtn?.focus?.();
        } catch (err) {
            console.error('Create game failed:', err);
            alert('Could not create game. Make sure you are signed in and try again.');
        } finally {
            isBusy = false;
        }
    });

    // Game Ready: dismiss communication reminder
    on(callReminderDismiss, 'click', () => {
        reminderDismissed = true;
        if (callReminderEl) callReminderEl.hidden = true;
    });

    // Game Ready: Go to Lobby
    on(goToLobbyBtn, 'click', async () => {
        if (!currentGameId) return;
        try {
            await renderLobby(currentGameId);
        } catch (err) {
            console.error('Failed to render lobby:', err);
            alert('Could not enter lobby.');
        }
    });

    // Game Ready: End game
    on(endGameFromReadyBtn, 'click', async (e) => {
        e.preventDefault();
        if (!currentGameId) return;

        const res = await doConfirmDelete();
        if (res !== 'confirm') return;

        try {
            await doRemoveGame(currentGameId);

            doCapture('pt_game_create_abandoned', {
                create_attempt_id: attemptId ?? undefined,
                game_session_id: attemptGameMeta?.analyticsId ?? undefined,
                round_id: attemptGameMeta?.roundId ?? undefined,
                board_id: attemptBoardMeta?.boardId ?? undefined,
                role: 'gm',
                origin: attemptOrigin ?? undefined,
            });

            resetCreate();
            showView('home');
        } catch (err) {
            console.error('Failed to delete game:', err);
            alert('Could not delete the game.');
        }
    });

    // Game Ready: Copy invite link
    on(shareCodeBtn, 'click', async () => {
        if (!currentGameId) return;

        const inviteUrl = `${window.location.origin}/#${currentGameId.toUpperCase()}`;

        try {
            await navigator.clipboard.writeText(inviteUrl);
            flashCheckmark(shareCodeBtn);
            // Brief text confirmation in the nearby instruction paragraph
            const instrEl = shareCodeBtn.closest('main')?.querySelector('.ready-instruction');
            if (instrEl) {
                const original = instrEl.textContent;
                instrEl.textContent = '✓ Invite link copied';
                setTimeout(() => { instrEl.textContent = original; }, 2000);
            }
        } catch (err) {
            console.error('Clipboard failed:', err);
            alert(`Invite link:\n${inviteUrl}`);
        }
    });

    // ───────────────────────────────────────────────────────────────────────────
    // Public entry
    // ───────────────────────────────────────────────────────────────────────────

    /**
     * Enter the Create Game flow.
     * @param {'new'|'play_again'} [origin] - How the user got here.
     */
    function startCreateFlow(origin = 'new') {
        attemptId = generateId();
        attemptOrigin = origin;
        attemptBoardMeta = null;
        attemptGameMeta = null;
        isBusy = false;
        currentGameId = generateGameId();
        setSession({ gameId: currentGameId, isGM: true }); // keep role early for UI
        resetCreate();
        gotoStep(1);
        showView('create');
        doCapture('pt_game_create_started', {
            create_attempt_id: attemptId,
            origin: attemptOrigin,
            role: 'gm',
        });
    }

    return { startCreateFlow };
}
