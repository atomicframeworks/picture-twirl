// tests/fixtures.js
//
// Custom Playwright fixtures. The `gm` fixture creates a fresh game as the GM
// (driving the real create flow against the real Firebase project), leaves the
// GM in the lobby, and exposes:
//
//   gm.page    — the GM's page (this context IS the host; reuse it for GM acts)
//   gm.gameId  — the game code, for sub-tests to join as players
//   gm.context — the GM browser context
//
// It is test-scoped: each test gets its own isolated game (order-independent),
// and the game is ended in teardown to avoid leaving active games behind.
//
// The GM context starts with the GM onboarding tour already dismissed
// (localStorage, see game/gmOnboarding.js) so the tour's overlay doesn't sit on
// top of the lobby controls. The tour itself is covered by tour.spec.js.
//
// Usage:
//   import { test, expect } from './fixtures.js';
//   test('players can join', async ({ gm, browser }) => {
//       const { page: player } = await joinAsPlayer(browser, gm.gameId, 'Sam');
//       ...
//   });

import { test as base, expect } from '@playwright/test';
import { createGameAsGM, gmGoToLobby, endGameFromLobby, skipGMTour } from './helpers.js';

export const test = base.extend({
    gm: async ({ browser }, use) => {
        const context = await browser.newContext();
        await skipGMTour(context);
        const page = await context.newPage();

        const gameId = await createGameAsGM(page);
        await gmGoToLobby(page);

        await use({ context, page, gameId });

        // Teardown: end the game, then close the GM context.
        await endGameFromLobby(page).catch(() => {});
        await context.close().catch(() => {});
    },
});

export { expect };
