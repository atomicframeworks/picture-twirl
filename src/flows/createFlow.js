// src/flows/createFlow.js
//
// Create Game — 3-step flow (Details → Select Set → Game Ready)
// -----------------------------------------------------------------------------
// Step 1:
//   - Validate GM name, Game name, (optional) team names.
//   - "Next" enabled only when valid.
// Step 2:
//   - Scrollable list of sets with fixed header + bottom tray.
//   - "Next" enabled only when a set is selected.
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
import { LIMITS } from '../config.js';
import { rtdb } from '../firebase.js';
import { ref, remove } from 'firebase/database';
import * as P from '../data/paths.js';
import { modal } from '../ui/modal.js';

export function initCreateFlow(deps) {
    const {
        requireAuth,
        predefinedGames,
        createGameShell,
        renderLobby,
        setSession,
        showView,
        generateGameId,

        // Step 1 elements
        createGameForm,
        gmNameInput,
        gameNameInput,
        teamANameInput,
        teamBNameInput,

        // Step 2 elements
        step1Root,
        step2Root,
        step1NextBtn,
        step1ExitBtn,        step2BackBtn,
        step2NextBtn,
        setListEl,
        headerTitleEl,

        // Game Ready screen elements
        readyGameTitle,
        readyGameCode,
        shareCodeBtn,
        goToLobbyBtn,
        endGameFromReadyBtn,
    } = deps;

    // Internal state
    let currentGameId = null;
    let selectedSetId = '';
    const teamsOn = true; // Teams are always enabled in this version

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
        return !!selectedSetId;
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

    function renderSetCards() {
        if (!setListEl) return;

        const sets = Array.isArray(predefinedGames) ? predefinedGames : [];
        if (!sets.length) {
            setListEl.innerHTML = '<div style="color:#666">No question sets found.</div>';
            return;
        }

        setListEl.innerHTML = sets.map(s => {
            const selected = s.id === selectedSetId ? ' is-selected' : '';
            const icon = s.icon || '🃏';
            const sub = s.subtitle || s.description || '';
            return `
        <button class="set-card${selected}" data-set="${s.id}" type="button" aria-pressed="${selected ? 'true' : 'false'}">
          <div class="set-ic" aria-hidden="true">${icon}</div>
          <div>
            <div class="set-title">${s.title || s.id}</div>
            ${sub ? `<div class="set-sub">${sub}</div>` : ''}
          </div>
        </button>
      `;
        }).join('');

        // Click wire
        setListEl.querySelectorAll('.set-card').forEach(btn => {
            on(btn, 'click', () => {
                selectedSetId = btn.getAttribute('data-set') || '';
                // update selection UI quickly
                setListEl.querySelectorAll('.set-card').forEach(b => {
                    const onSel = b.getAttribute('data-set') === selectedSetId;
                    b.classList.toggle('is-selected', onSel);
                    b.setAttribute('aria-pressed', onSel ? 'true' : 'false');
                });
                updateStep2NextEnabled();
            });
        });
    }

    function resetCreate() {
        createGameForm?.reset?.();
        selectedSetId = '';
        updateStep1NextEnabled();
        updateStep2NextEnabled();
        if (setListEl) setListEl.innerHTML = '';
        if (headerTitleEl) headerTitleEl.textContent = '';
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Live validation & events
    // ───────────────────────────────────────────────────────────────────────────
    if (createGameForm) ['input', 'change'].forEach(evt =>
        on(createGameForm, evt, updateStep1NextEnabled, true)
    );

    // Step 1: Form submit handler (Enter key support)
    on(createGameForm, 'submit', (e) => {
        e?.preventDefault?.();
        if (!step1Root?.hidden && isStep1Valid()) {
            step1NextBtn?.click();
        }
    });

    // Step 1: Also listen for Enter key directly on the form
    on(createGameForm, 'keydown', (e) => {
        if (e.key === 'Enter' && !step1Root?.hidden && isStep1Valid()) {
            e?.preventDefault?.();
            step1NextBtn?.click();
        }
    });

    // Step 1 Next
    on(step1NextBtn, 'click', async (e) => {
        e?.preventDefault?.();
        if (!isStep1Valid()) return;

        const gmDisplayName = (gmNameInput?.value || '').trim().slice(0, LIMITS.DISPLAY_NAME);
        const gameDisplayName = (gameNameInput?.value || '').trim().slice(0, LIMITS.GAME_TITLE);
        setSession({ displayName: gmDisplayName, isGM: true });

        // Update the header for Step 2 (title = game name)
        if (headerTitleEl) headerTitleEl.textContent = gameDisplayName || 'Picture Twirl';

        // Populate set cards
        renderSetCards();
        updateStep2NextEnabled();
        gotoStep(2);
    });

    // Step 1 Exit
    on(step1ExitBtn, 'click', (e) => {
        e?.preventDefault?.();
        resetCreate();
        showView('home');
    });

    // Step 2 Back
    on(step2BackBtn, 'click', (e) => {
        e?.preventDefault?.();
        gotoStep(1);
        updateStep1NextEnabled();
    });

    // Step 2: Enter key support
    on(step2Root, 'keydown', (e) => {
        if (e.key === 'Enter' && !step2Root?.hidden && isStep2Valid() && !step2NextBtn?.disabled) {
            e?.preventDefault?.();
            step2NextBtn?.click();
        }
    });

    // Step 2 Next (finalize → create → show Game Ready)
    on(step2NextBtn, 'click', async (e) => {
        e?.preventDefault?.();
        if (!isStep2Valid()) return;

        try {
            await requireAuth(); // ensure auth.uid exists

            const gmDisplayName = (gmNameInput?.value || '').trim().slice(0, LIMITS.DISPLAY_NAME);
            const gameDisplayName = (gameNameInput?.value || '').trim().slice(0, LIMITS.GAME_TITLE);
            const teamA = teamsOn ? (teamANameInput?.value.trim() || 'Team A') : '';
            const teamB = teamsOn ? (teamBNameInput?.value.trim() || 'Team B') : '';

            setSession({ displayName: gmDisplayName, isGM: true });

            await createGameShell(currentGameId, {
                setId: selectedSetId,
                title: gameDisplayName,
                gmName: gmDisplayName,
                teamsEnabled: teamsOn,
                teamA,
                teamB,
            });

            // Show Game Ready screen
            if (readyGameTitle) readyGameTitle.textContent = gameDisplayName;
            if (readyGameCode) readyGameCode.textContent = currentGameId.toUpperCase();
            showView('gameReady');
            // Focus the "Go to Lobby" button so Enter works naturally
            goToLobbyBtn?.focus?.();
        } catch (err) {
            console.error('Create game failed:', err);
            alert('Could not create game. Make sure you are signed in and try again.');
        }
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
        e?.preventDefault?.();
        if (!currentGameId) return;

        const res = await modal.confirm({
            title: 'End game?',
            body: 'This will delete the game. You can\'t undo this.',
            confirmText: 'End game',
            variant: 'danger'
        });

        if (res !== 'confirm') return;

        try {
            await remove(ref(rtdb, P.game(currentGameId)));
            resetCreate();
            showView('home');
        } catch (err) {
            console.error('Failed to delete game:', err);
            alert('Could not delete the game.');
        }
    });

    // Game Ready: Share code
    on(shareCodeBtn, 'click', async () => {
        if (!currentGameId) return;

        const gameDisplayName = (gameNameInput?.value || '').trim() || 'Picture Twirl';
        const shareData = {
            title: gameDisplayName,
            text: `Join my Picture Twirl game! Use code: ${currentGameId.toUpperCase()}`,
        };

        // Try native share API first (mobile)
        if (navigator.share) {
            try {
                await navigator.share(shareData);
                return;
            } catch (err) {
                if (err.name !== 'AbortError') console.warn('Share failed:', err);
                // Fall through to clipboard
            }
        }

        // Fallback: copy to clipboard
        try {
            await navigator.clipboard.writeText(currentGameId.toUpperCase());
            flashCheckmark(shareCodeBtn);
        } catch (err) {
            console.error('Clipboard failed:', err);
            alert(`Game code: ${currentGameId.toUpperCase()}\n\nCopy this code to share with players.`);
        }
    });

    // ───────────────────────────────────────────────────────────────────────────
    // Public entry
    // ───────────────────────────────────────────────────────────────────────────
    function startCreateFlow() {
        currentGameId = generateGameId();
        setSession({ gameId: currentGameId, isGM: true }); // keep role early for UI
        resetCreate();
        gotoStep(1);
        showView('create');
    }

    return { startCreateFlow };
}
