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
import { attachDiceButton } from '../ui/diceButton.js';
import { LIMITS } from '../config.js';
import { randomPlayerName } from '../names.js';
import { resolvePlayerName, savePlayerName } from '../prefs.js';

/**
 * @typedef JoinServices
 * @property {Function} requireAuth
 * @property {(gameId: string) => Promise<boolean>} gameExists
 * @property {(gameId: string) => Promise<string|null>} getGamePhase
 * @property {(gameId: string) => Promise<{ exists: boolean, phase: string|null, host: boolean }>} [getRoomInfo]
 *   one call for all three; host = this browser created the game (AUDIT M15)
 * @property {Function} renderLobby
 * @property {Function} renderLateJoin
 * @property {Function} setSession
 * @property {Function} showView
 *
 * @typedef JoinEls
 * @property {HTMLFormElement|null} joinForm
 * @property {HTMLButtonElement|null} confirmJoin
 * @property {HTMLButtonElement|null} cancelJoinBtn
 * @property {HTMLInputElement|null} joinGameIdInput
 * @property {HTMLInputElement|null} playerNameInput
 * @property {HTMLButtonElement|null} playerNameRollBtn
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
        getGamePhase,
        getRoomInfo,
        renderLobby,
        renderLateJoin,
        setSession,
        showView,
    } = services;

    const {
        joinForm,
        confirmJoin,
        cancelJoinBtn,
        joinGameIdInput,
        playerNameInput,
        playerNameRollBtn,
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

    // Remember an edited screen name (change fires on blur / before button clicks)
    on(elPlayerNameInput, 'change', () => savePlayerName(elPlayerNameInput?.value || ''));

    // Dice: roll a new screen name (never the one already shown) and remember it
    attachDiceButton(playerNameRollBtn, () => {
        if (!elPlayerNameInput) return;
        const next = randomPlayerName([elPlayerNameInput.value]).slice(0, LIMITS.DISPLAY_NAME);
        elPlayerNameInput.value = next;
        savePlayerName(next);
        validateJoinForm();
    });

    // Form submit handler (Enter key support)
    on(elJoinForm, 'submit', (e) => {
        e.preventDefault();
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

        // Screen name: remembered from a previous game on this device, or a
        // freshly generated one. reset() wiped it, so this always runs after.
        if (elPlayerNameInput) elPlayerNameInput.value = resolvePlayerName();

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
            savePlayerName(playerName);

            // Guard against double-click
            if (elConfirmJoin?.dataset?.busy === '1') return;
            if (elConfirmJoin) elConfirmJoin.dataset.busy = '1';
            disable(elConfirmJoin);

            const info = getRoomInfo
                ? await getRoomInfo(id)
                : { exists: await gameExists(id), phase: getGamePhase ? await getGamePhase(id) : null, host: false };
            if (!info.exists) {
                showJoinError('Sorry, game not found. Please check with your host.');
                validateJoinForm(); // re-enable if fields still filled
                return;
            }
            const { phase } = info;

            // The game's own host coming back (closed the tab, new tab, rejoined by code):
            // they get the GM seat back instead of joining as a player (AUDIT M15).
            // The lobby forwards to the live game or the finale by phase.
            if (info.host && phase !== 'sessionEnded') {
                setSession({ gameId: id, isGM: true, displayName: playerName });
                await renderLobby(id);
                return;
            }

            if (phase === 'ended' || phase === 'sessionEnded') {
                showJoinError('This game has already ended.');
                validateJoinForm();
                return;
            }

            // Seed session (non-GM)
            setSession({ gameId: id, isGM: false, displayName: playerName });

            if (phase === 'live') {
                // Game in progress — enter as pending, wait for GM approval
                await renderLateJoin(id);
            } else {
                // Lobby (or phase unknown) — enter lobby normally
                await renderLobby(id);
            }
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
