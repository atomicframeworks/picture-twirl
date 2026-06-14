// tests/helpers.js
//
// Reusable flows for driving Picture Twirl in the browser.
// Selectors come from index.html (#ids) and the lobby/game <template>s
// ([data-ref="…"]). Modal buttons are .pt-m-btn (see ui/modal.js).

import { expect } from '@playwright/test';

/**
 * Create a game as the GM, all the way to the "Game ready" screen, and return
 * the game code. The passed `page` becomes the GM (its anon uid == hostUid),
 * so keep using THIS page for any later GM actions.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ gmName?: string, gameName?: string, teamA?: string, teamB?: string }} [opts]
 * @returns {Promise<string>} the game code (uppercase)
 */
export async function createGameAsGM(page, opts = {}) {
    const {
        gmName = 'Test GM',
        gameName = 'E2E Game',
        teamA = 'Red',
        teamB = 'Blue',
    } = opts;

    await page.goto('/');
    await expect(page.locator('#newGameBtn')).toBeEnabled({ timeout: 15_000 });
    await page.locator('#newGameBtn').click();

    // Step 1 — details
    await page.locator('#gmName').fill(gmName);
    await page.locator('#gameName').fill(gameName);
    await page.locator('#teamAName').fill(teamA);
    await page.locator('#teamBName').fill(teamB);
    await expect(page.locator('#step1NextBtn')).toBeEnabled();
    await page.locator('#step1NextBtn').click();

    // Step 2 — pick the first question set
    const firstSet = page.locator('#setList .set-card').first();
    await expect(firstSet).toBeVisible();
    await firstSet.click();
    await expect(page.locator('#step2NextBtn')).toBeEnabled();
    await page.locator('#step2NextBtn').click();

    // Game ready — read the code
    await expect(page.locator('#gameReady')).toBeVisible();
    const code = (await page.locator('#readyGameCode').textContent())?.trim() || '';
    expect(code).toMatch(/^[A-Z0-9]{4,}$/);
    return code;
}

/** From the "Game ready" screen, enter the lobby. */
export async function gmGoToLobby(page) {
    await page.locator('#goToLobbyBtn').click();
    await expect(page.locator('.lobby-root')).toBeVisible();
}

/**
 * Open a fresh player context and join `gameId` via the Join flow.
 * Returns the player's Page (left sitting in the lobby).
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {string} gameId
 * @param {string} name
 * @returns {Promise<{ context: import('@playwright/test').BrowserContext, page: import('@playwright/test').Page }>}
 */
export async function joinAsPlayer(browser, gameId, name) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.locator('#joinGameBtn')).toBeEnabled({ timeout: 15_000 });
    await page.locator('#joinGameBtn').click();
    await page.locator('#joinGameId').fill(gameId);
    await page.locator('#playerName').fill(name);
    await expect(page.locator('#confirmJoin')).toBeEnabled();
    await page.locator('#confirmJoin').click();
    await expect(page.locator('.lobby-root')).toBeVisible();
    return { context, page };
}

/** Best-effort cleanup: GM ends the game (phase -> ended) via the lobby tray. */
export async function endGameFromLobby(page) {
    const endLink = page.locator('[data-ref="gmEnd"]');
    if (await endLink.count() === 0) return;
    await endLink.click();
    // Confirm in the modal.
    const confirmBtn = page.locator('.pt-modal .pt-m-btn', { hasText: 'End game' });
    await confirmBtn.click({ timeout: 5_000 }).catch(() => {});
}
