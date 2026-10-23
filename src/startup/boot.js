// src/startup/boot.js
//
// Picture Twirl — App Bootstrap
// -----------------------------------------------------------------------------
// Responsibilities
// - Set up the realtime client (live games: src/realtime/) and the player identity.
// - Find & cache root DOM elements once.
// - Centralize view switching (Home / Create / Join) via ui/views.js.
// - Wire the Create and Join flows (form validation, actions).
// - Keep boot() tiny, documented, and tolerant of missing optional elements.
// -----------------------------------------------------------------------------
//
// Dependencies (unchanged):
// - realtime/client.js: initializeRealtime, waitForAuthReady, requireAuth, getRoomInfo, reserveGameCode
// - ui/dom.js: byId, enable, disable, on
// - ui/views.js: createViewController
// - flows/createFlow.js: initCreateFlow
// - flows/joinFlow.js: initJoinFlow
// - session.js: setSession (for seed state)
// - (boards come from /api/boards — see flows/createFlow.js + ui/boardPicker.js)
//
// Notes:
// - This file does NOT reach into RTDB directly; flows/services handle that.
// - All IDs referenced here match your existing markup.
// -----------------------------------------------------------------------------

import {
    initializeRealtime,
    waitForAuthReady,
    getCurrentUser,
    requireAuth,
    gameExists,
    getRoomInfo,
    reserveGameCode,
    realtimeStats,
    simulateDrop,
    rtdb,
} from '../realtime/client.js';

import { createGameShell } from '../game/createGame.js';
import { renderLobby } from '../game/lobby.js';
import { renderLateJoin } from '../game/renderLateJoin.js';
import { getSession, setSession } from '../session.js';
import { get, ref } from '../realtime/db.js';

import { byId, enable, disable, on } from '../ui/dom.js';
import { createViewController } from '../ui/views.js';
import { openHowToPlay } from '../ui/howToPlay.js';

import { initCreateFlow } from '../flows/createFlow.js';
import { initJoinFlow } from '../flows/joinFlow.js';
import { initAnalytics, capturePageview, capture } from '../analytics.js';

export async function boot() {
    console.log('Main.js Loaded');

    try {
        // -------------------------------------------------------------------------
        // Realtime client + anonymous player identity (src/realtime/client.js)
        // window.PictureTwirl.realtime.stats() → connection, round-trip times, clock offset
        // -------------------------------------------------------------------------
        await initializeRealtime();
        window.PictureTwirl = Object.assign(window.PictureTwirl || {}, { realtime: { stats: realtimeStats, simulateDrop } });

        if (import.meta.env.DEV) {
            // Dev-only: inspect analytics identifiers for the active game.
            // Usage: await window.PictureTwirl.getAnalyticsIds()
            // Returns { analyticsId, roundId } or null when no game is active.
            const getAnalyticsIds = async () => {
                const { gameId } = getSession();
                if (!gameId) return null;
                const snap = await get(ref(rtdb, `games/${gameId}`));
                const data = snap.val();
                if (!data) return null;
                return {
                    analyticsId: data.analyticsId ?? null,
                    roundId: data.settings?.roundId ?? null,
                };
            };
            window.PictureTwirl = Object.assign(window.PictureTwirl || {}, { getAnalyticsIds });
        }

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
        const howToPlayBtn = byId('howToPlayBtn');

        // -------------------------
        // Create flow (Step 1 — details)
        // -------------------------
        const createGameForm = byId('createGameForm');
        const gmNameInput = byId('gmName');
        const gmNameRollBtn = byId('gmNameRollBtn');
        const gameNameInput = byId('gameName');
        const gameNameRollBtn = byId('gameNameRollBtn');
        const teamANameInput = byId('teamAName');
        const teamBNameInput = byId('teamBName');
        const teamARollBtn = byId('teamARollBtn');
        const teamBRollBtn = byId('teamBRollBtn');

        // -------------------------
        // Create flow (Step 2 — set selection)
        // -------------------------
        const step1Root = byId('createStep1');
        const step2Root = byId('createStep2');

        const step1NextBtn = byId('step1NextBtn');
        const step1ExitBtn = byId('step1ExitBtn');

        const step2BackBtn = byId('step2BackBtn');
        const step2NextBtn = byId('step2NextBtn');

        const setListEl = byId('setList');        // where board cards are rendered
        const headerTitleEl = byId('create2Title'); // fixed header title (game name)

        // -------------------------
        // Create intro (first-time-only step before the create flow)
        // -------------------------
        const createIntroRoot = byId('createIntro');
        const createStep1Root = byId('createStep1');
        const createStep2Root = byId('createStep2');
        const introNextBtn = byId('introNextBtn');
        const introBackBtn = byId('introBackBtn');

        // -------------------------
        // Game Ready screen
        // -------------------------
        const readyGameTitle = byId('readyGameTitle');
        const readyGameCode = byId('readyGameCode');
        const shareCodeBtn = byId('shareCodeBtn');
        const goToLobbyBtn = byId('goToLobbyBtn');
        const endGameFromReadyBtn = byId('endGameFromReadyBtn');
        const callReminderEl = byId('callReminderEl');
        const callReminderDismiss = byId('callReminderDismiss');

        // -------------------------
        // Join flow bits
        // -------------------------
        const confirmJoin = byId('confirmJoin');
        const cancelJoinBtn = byId('cancelJoinBtn');
        const joinGameIdInput = byId('joinGameId');
        const playerNameInput = byId('playerName');
        const playerNameRollBtn = byId('playerNameRollBtn');
        const joinErrorRow = byId('joinErrorRow');
        const joinErrorText = byId('joinErrorText');

        // -------------------------------------------------------------------------
        // Disable entry actions until auth is ready (prevents perm race conditions)
        // -------------------------------------------------------------------------
        [newGameBtn, joinGameBtn].forEach(disable);
        if (confirmJoin) disable(confirmJoin);

        await waitForAuthReady();
        console.log('Player identity ready');

        // Initialise analytics once the anonymous identity is available.
        // No-op when VITE_POSTHOG_KEY is absent (local dev without a key set).
        initAnalytics(getCurrentUser()?.uid);
        capturePageview();

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
        // Initialize Create flow (2-step: details → pick a board → game ready)
        // -------------------------------------------------------------------------
        const { startCreateFlow } = initCreateFlow({
            services: {
                requireAuth,
                createGameShell,
                renderLobby,
                setSession,
                showView,
                generateGameId,
                reserveGameCode,
            },
            els: {
                // Step 1 (details)
                createGameForm,
                gmNameInput,
                gameNameInput,
                teamANameInput,
                teamBNameInput,
                gmNameRollBtn,
                gameNameRollBtn,
                teamARollBtn,
                teamBRollBtn,

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
                callReminderEl,
                callReminderDismiss,
            },
        });

        // -------------------------------------------------------------------------
        // Analytics context helper for the join flow:
        // fetches analyticsId + roundId for a game code (one call, fire-and-forget safe).
        // -------------------------------------------------------------------------
        const getGameAnalyticsContext = async (gameId) => {
            try {
                const [aSnap, sSnap] = await Promise.all([
                    get(ref(rtdb, `games/${gameId}/analyticsId`)),
                    get(ref(rtdb, `games/${gameId}/settings`)),
                ]);
                return {
                    analyticsId: aSnap.val() ?? null,
                    roundId: sSnap.val()?.roundId ?? null,
                };
            } catch {
                return { analyticsId: null, roundId: null };
            }
        };

        // -------------------------------------------------------------------------
        // Initialize Join flow (validation + confirm/cancel)
        // -------------------------------------------------------------------------
        const { startJoinFlow } = initJoinFlow({
            services: {
                requireAuth,
                gameExists,
                getGamePhase: async (id) => (await getRoomInfo(id)).phase,
                getRoomInfo,
                renderLobby,
                renderLateJoin,
                setSession,
                showView,
                capture,
                getGameAnalyticsContext,
            },
            els: {
                joinForm,
                confirmJoin,
                cancelJoinBtn,
                joinGameIdInput,
                playerNameInput,
                playerNameRollBtn,
                joinErrorRow,
                joinErrorText,
            },
        });

        // -------------------------------------------------------------------------
        // Create intro: first-time-only message before the real create flow.
        // localStorage key pt.create.intro.v1 marks it as seen.
        // If localStorage is unavailable the intro still shows but won't persist.
        // -------------------------------------------------------------------------
        let introSeen = (() => {
            try { return localStorage.getItem('pt.create.intro.v1') === '1'; } catch { return false; }
        })();

        function showCreateIntro() {
            if (createStep1Root) createStep1Root.hidden = true;
            if (createStep2Root) createStep2Root.hidden = true;
            if (createIntroRoot) createIntroRoot.hidden = false;
            showView('create');
        }

        function hideCreateIntro() {
            if (createIntroRoot) createIntroRoot.hidden = true;
        }

        on(introNextBtn, 'click', () => {
            introSeen = true;
            try { localStorage.setItem('pt.create.intro.v1', '1'); } catch {}
            hideCreateIntro();
            startCreateFlow('new');
        });

        on(introBackBtn, 'click', (e) => {
            e.preventDefault();
            hideCreateIntro();
            showView('home');
        });

        // -------------------------------------------------------------------------
        // Top-level nav buttons
        // -------------------------------------------------------------------------
        on(newGameBtn, 'click', () => {
            if (introSeen) {
                startCreateFlow('new');
            } else {
                showCreateIntro();
            }
        });
        on(joinGameBtn, 'click', () => startJoinFlow());
        on(howToPlayBtn, 'click', () => openHowToPlay({
            context: 'home',
            onStartNewGame: startCreateFlow,
            onJoinGame: () => startJoinFlow(),
        }));

        // -------------------------------------------------------------------------
        // Post-game navigation intent (set by renderFinale ended-session card)
        // Read once, clear immediately so a reload/back-nav doesn't re-trigger.
        // -------------------------------------------------------------------------
        const homeIntent = (() => {
            try {
                const v = sessionStorage.getItem('pictureTwirlOnHomeIntent');
                if (v) sessionStorage.removeItem('pictureTwirlOnHomeIntent');
                return v;
            } catch { return null; }
        })();
        if (homeIntent === 'create') {
            startCreateFlow('play_again');
        } else if (homeIntent === 'join') {
            startJoinFlow();
        }

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
