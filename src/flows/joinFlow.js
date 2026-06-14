// src/flows/joinFlow.js
//
// Picture Twirl — Join Game Flow (UI-only)
// -----------------------------------------------------------------------------
// Responsibilities
// - Live-validate the Join form (game code + player name).
// - Show inline error if the game code doesn’t exist (host not created yet).
// - Prevent double-submits while checking existence.
// - On success, seed session (displayName, isGM: false) and enter Lobby.
//
// Notes
// - Pure UI/controller logic: no direct DB path knowledge here.
// - All services (auth, existence check, lobby render, session) are injected.
// - Null-safe: gracefully tolerates missing optional DOM nodes.
// -----------------------------------------------------------------------------

import { on, enable, disable } from '../ui/dom.js';
import { LIMITS } from '../config.js';

/**
 * @typedef JoinServices
 * @property {Function} requireAuth
 * @property {(gameId: string) => Promise<boolean>} gameExists
 * @property {Function} renderLobby
 * @property {Function} setSession
 * @property {Function} showView
 *
 * @typedef JoinEls
 * @property {HTMLFormElement|null} joinForm
 * @property {HTMLButtonElement|null} confirmJoin
 * @property {HTMLButtonElement|null} cancelJoinBtn
 * @property {HTMLInputElement|null} joinGameIdInput
 * @property {HTMLInputElement|null} playerNameInput
 * @property {HTMLElement|null} joinErrorRow
 * @property {HTMLElement|null} joinErrorText
 */

/**
 * Initialize the Join Game flow.
 * @param {{ services: JoinServices, els: JoinEls }} deps
 */
export function initJoinFlow({ services, els }) {
    const {
        requireAuth,
        gameExists,
        renderLobby,
        setSession,
        showView,
    } = services;

    const {
        joinForm,
        confirmJoin,
        cancelJoinBtn,
        joinGameIdInput,
        playerNameInput,
        joinErrorRow,
        joinErrorText,
    } = els;

    // Local aliases to avoid bundler/scope quirks
    const elJoinForm = joinForm;
    const elConfirmJoin = confirmJoin;
    const elCancelJoin = cancelJoinBtn;
    const elJoinGameIdInput = joinGameIdInput;
    const elPlayerNameInput = playerNameInput;
    const elJoinErrorRow = joinErrorRow;
    const elJoinErrorText = joinErrorText;

    // ---------------------------------------------------------------------------
    // Inline error helpers
    // ---------------------------------------------------------------------------
    function clearJoinError() {
        if (elJoinErrorRow) elJoinErrorRow.setAttribute('hidden', '');
        elJoinGameIdInput?.classList.remove('is-error');
    }

    function showJoinError(msg) {
        if (elJoinErrorText) {
            elJoinErrorText.textContent =
                (typeof msg === 'string' && msg.trim()) ||
                'Sorry, game not found. Please check with your host.';
        }
        elJoinErrorRow?.removeAttribute('hidden');
        elJoinGameIdInput?.classList.add('is-error');
    }

    // ---------------------------------------------------------------------------
    // Validation — single source of truth
    // ---------------------------------------------------------------------------
    function validateJoinForm() {
        const code = (elJoinGameIdInput?.value || '').trim();
        const name = (elPlayerNameInput?.value || '').trim();
        const ok = !!code && !!name;
        ok ? enable(elConfirmJoin) : disable(elConfirmJoin);
        return ok;
    }

    // Keep validation live and clear errors on input
    if (elJoinForm) {
        ['input', 'change'].forEach((evt) => on(elJoinForm, evt, () => {
            clearJoinError();
            validateJoinForm();
        }, true));
    }

    // Form submit handler (Enter key support)
    on(elJoinForm, 'submit', (e) => {
        e?.preventDefault?.();
        if (validateJoinForm() && elConfirmJoin?.dataset?.busy !== '1') {
            elConfirmJoin?.click();
        }
    });

    // ---------------------------------------------------------------------------
    // Public: start the Join flow (wired by boot to the "Join Game" button)
    // ---------------------------------------------------------------------------
    function startJoinFlow(prefillCode = '') {
        // Reset the visible form state (works if joinForm is a <form>)
        elJoinForm?.reset?.();
        clearJoinError();

        // Pre-fill game code if provided
        if (prefillCode && elJoinGameIdInput) {
            elJoinGameIdInput.value = prefillCode.toUpperCase();
        }

        validateJoinForm();
        // Optional: focus first field (or second if code is pre-filled)
        if (prefillCode && elPlayerNameInput) {
            elPlayerNameInput?.focus?.();
        } else {
            elJoinGameIdInput?.focus?.();
        }
        showView('join');
    }

    // ---------------------------------------------------------------------------
    // Cancel → Home
    // ---------------------------------------------------------------------------
    on(elCancelJoin, 'click', () => {
        elJoinForm?.reset?.();
        clearJoinError();
        validateJoinForm();
        showView('home');
    });

    // ---------------------------------------------------------------------------
    // Confirm → check existence → enter Lobby
    // ---------------------------------------------------------------------------
    on(elConfirmJoin, 'click', async () => {
        try {
            await requireAuth();
            if (!validateJoinForm()) return;

            clearJoinError();

            const id = (elJoinGameIdInput?.value || '').trim().toLowerCase();
            const playerName = (elPlayerNameInput?.value || '').trim().slice(0, LIMITS.DISPLAY_NAME);

            // Guard against double-click
            if (elConfirmJoin?.dataset?.busy === '1') return;
            if (elConfirmJoin) elConfirmJoin.dataset.busy = '1';
            disable(elConfirmJoin);

            const exists = await gameExists(id);
            if (!exists) {
                showJoinError('Sorry, game not found. Please check with your host.');
                validateJoinForm(); // re-enable if fields still filled
                return;
            }

            // Seed session (non-GM)
            setSession({ gameId: id, isGM: false, displayName: playerName });

            // Enter Lobby
            await renderLobby(id);
        } catch (err) {
            console.error('Join game failed:', err);
            showJoinError('Could not join. Please verify the code and try again.');
            validateJoinForm();
        } finally {
            if (elConfirmJoin) elConfirmJoin.dataset.busy = '0';
        }
    });

    // Expose only the entry to the flow
    return { startJoinFlow };
}
