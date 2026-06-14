// src/startup/boot.js
//
// Picture Twirl — App Bootstrap
// -----------------------------------------------------------------------------
// Responsibilities
// - Initialize Firebase and wait for Anonymous Auth to settle (avoids race bugs).
// - Find & cache root DOM elements once.
// - Centralize view switching (Home / Create / Join) via ui/views.js.
// - Wire the Create and Join flows (form validation, actions).
// - Keep boot() tiny, documented, and tolerant of missing optional elements.
// -----------------------------------------------------------------------------
//
// Dependencies (unchanged):
// - firebase.js: initializeFirebase, waitForAuthReady, requireAuth, gameExists
// - ui/dom.js: byId, enable, disable, on
// - ui/views.js: createViewController
// - flows/createFlow.js: initCreateFlow
// - flows/joinFlow.js: initJoinFlow
// - session.js: setSession (for seed state)
// - predefinedGames.js: predefinedGames (for the selector)
//
// Notes:
// - This file does NOT reach into RTDB directly; flows/services handle that.
// - All IDs referenced here match your existing markup.
// -----------------------------------------------------------------------------

import {
    initializeFirebase,
    waitForAuthReady,
    requireAuth,
    gameExists,
} from '../firebase.js';

import { predefinedGames } from '../predefinedGames.js';
import { createGameShell } from '../game/createGame.js';
import { renderLobby } from '../game/lobby.js';
import { setSession } from '../session.js';

import { byId, enable, disable, on } from '../ui/dom.js';
import { createViewController } from '../ui/views.js';

import { initCreateFlow } from '../flows/createFlow.js';
import { initJoinFlow } from '../flows/joinFlow.js';

export async function boot() {
    console.log('Main.js Loaded');

    try {
        // -------------------------------------------------------------------------
        // Firebase initialization + Anonymous Auth gate
        // -------------------------------------------------------------------------
        await initializeFirebase();

        // -------------------------------------------------------------------------
        // Cache DOM roots once (tolerant of optional nodes)
        // -------------------------------------------------------------------------
        // Root wrappers (views)
        const home = byId('home');
        const startNewGame = byId('startNewGame');
        const gameReady = byId('gameReady');
        const joinForm = byId('joinForm');

        // Home internals
        const siteTitle = byId('siteTitle');
        const startingOptions = byId('startingOptions');
        const newGameBtn = byId('newGameBtn');
        const joinGameBtn = byId('joinGameBtn');

        // -------------------------
        // Create flow (Step 1 — details)
        // -------------------------
        const createGameForm = byId('createGameForm');
        const gmNameInput = byId('gmName');
        const gameNameInput = byId('gameName');
        const teamANameInput = byId('teamAName');
        const teamBNameInput = byId('teamBName');

        // -------------------------
        // Create flow (Step 2 — set selection)
        // -------------------------
        const step1Root = byId('createStep1');
        const step2Root = byId('createStep2');

        const step1NextBtn = byId('step1NextBtn');
        const step1ExitBtn = byId('step1ExitBtn');

        const step2BackBtn = byId('step2BackBtn');
        const step2NextBtn = byId('step2NextBtn');

        const setListEl = byId('setList');        // where set cards are rendered
        const headerTitleEl = byId('create2Title'); // fixed header title (game name)

        // -------------------------
        // Game Ready screen
        // -------------------------
        const readyGameTitle = byId('readyGameTitle');
        const readyGameCode = byId('readyGameCode');
        const shareCodeBtn = byId('shareCodeBtn');
        const goToLobbyBtn = byId('goToLobbyBtn');
        const endGameFromReadyBtn = byId('endGameFromReadyBtn');

        // -------------------------
        // Join flow bits
        // -------------------------
        const confirmJoin = byId('confirmJoin');
        const cancelJoinBtn = byId('cancelJoinBtn');
        const joinGameIdInput = byId('joinGameId');
        const playerNameInput = byId('playerName');
        const joinErrorRow = byId('joinErrorRow');
        const joinErrorText = byId('joinErrorText');

        // -------------------------------------------------------------------------
        // Disable entry actions until auth is ready (prevents perm race conditions)
        // -------------------------------------------------------------------------
        [newGameBtn, joinGameBtn].forEach(disable);
        if (confirmJoin) disable(confirmJoin);

        await waitForAuthReady();
        console.log('Anonymous Auth ready');

        // -------------------------------------------------------------------------
        // View controller — single source of truth for Home/Create/GameReady/Join visibility
        // -------------------------------------------------------------------------
        const { showView } = createViewController({
            home,
            create: startNewGame,
            gameReady,
            join: joinForm,
            siteTitle,
            startingOptions,
        });

        // Check URL hash for game code BEFORE showing home (which clears hash)
        const urlHash = window.location.hash.replace('#', '').trim();
        const gameCodeFromUrl = urlHash ? urlHash : null;

        // Initial route: Home (only show if no game code in URL)
        if (!gameCodeFromUrl) {
            showView('home');
        }

        // Re-enable entry buttons now that auth.uid exists
        [newGameBtn, joinGameBtn].forEach(enable);

        // -------------------------------------------------------------------------
        // Shared helper: friendly game code generator (stable across flows)
        // -------------------------------------------------------------------------
        const generateGameId = () => Math.random().toString(36).substring(2, 8);

        // -------------------------------------------------------------------------
        // Initialize Create flow (2-step: details → set selection → game ready)
        // -------------------------------------------------------------------------
        const { startCreateFlow } = initCreateFlow({
            services: {
                requireAuth,
                predefinedGames,
                createGameShell,
                renderLobby,
                setSession,
                showView,
                generateGameId,
            },
            els: {
                // Step 1 (details)
                createGameForm,
                gmNameInput,
                gameNameInput,
                teamANameInput,
                teamBNameInput,

                // Step 2 (set selection)
                step1Root,
                step2Root,
                step1NextBtn,
                step1ExitBtn,
                step2BackBtn,
                step2NextBtn,
                setListEl,
                headerTitleEl,

                // Game Ready screen
                readyGameTitle,
                readyGameCode,
                shareCodeBtn,
                goToLobbyBtn,
                endGameFromReadyBtn,
            },
        });

        // -------------------------------------------------------------------------
        // Initialize Join flow (validation + confirm/cancel)
        // -------------------------------------------------------------------------
        const { startJoinFlow } = initJoinFlow({
            services: {
                requireAuth,
                gameExists,
                renderLobby,
                setSession,
                showView,
            },
            els: {
                joinForm,
                confirmJoin,
                cancelJoinBtn,
                joinGameIdInput,
                playerNameInput,
                joinErrorRow,
                joinErrorText,
            },
        });

        // -------------------------------------------------------------------------
        // Top-level nav buttons
        // -------------------------------------------------------------------------
        on(newGameBtn, 'click', startCreateFlow);
        on(joinGameBtn, 'click', () => startJoinFlow());

        // -------------------------------------------------------------------------
        // Auto-join if game code is in URL
        // -------------------------------------------------------------------------
        if (gameCodeFromUrl) {
            // Start join flow with pre-filled code (keep hash in URL for sharing)
            startJoinFlow(gameCodeFromUrl);
        }

        // -------------------------------------------------------------------------
        // Listen for hash changes (e.g., user changes URL manually)
        // -------------------------------------------------------------------------
        window.addEventListener('hashchange', () => {
            const newHash = window.location.hash.replace('#', '').trim();
            if (newHash) {
                // Automatically open join flow with new code
                startJoinFlow(newHash);
            }
        });

    } catch (e) {
        console.error('Initialization error:', e);
        alert('Initialization failed. Check console for details.');
    }
}
