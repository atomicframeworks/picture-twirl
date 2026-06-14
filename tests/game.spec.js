// tests/game.spec.js — drive to the LIVE game board and screenshot the key states
import { test, expect } from './fixtures.js';
import { joinAsPlayer } from './helpers.js';

test('live game: board, question/swirl, and buzz', async ({ gm, browser }) => {
    // 1) A player joins and takes Team B; GM takes Team A (need 1 per team to start).
    const { context, page: player } = await joinAsPlayer(browser, gm.gameId, 'Sam');
    try {
        // Wait until each join button is wired by the lobby observer before clicking,
        // then confirm the join landed (button flips to "Leave").
        const joinB = player.locator('[data-ref="teamBAction"]');
        await expect(joinB).toHaveAttribute('data-action', 'join-B');
        await joinB.click();
        await expect(joinB).toHaveText('Leave');

        const joinA = gm.page.locator('[data-ref="teamAAction"]');
        await expect(joinA).toHaveAttribute('data-action', 'join-A');
        await joinA.click();
        await expect(joinA).toHaveText('Leave');

        // 2) GM starts the game → both clients mount the live board.
        await gm.page.locator('[data-ref="gmStart"]').click();
        await expect(gm.page.locator('.game-root')).toBeVisible({ timeout: 15_000 });
        await expect(player.locator('.game-root')).toBeVisible({ timeout: 15_000 });

        // Board view (GM sees the grid).
        await expect(gm.page.locator('#board .tile').first()).toBeVisible();
        await gm.page.screenshot({ path: 'screenshots/08-game-board.png' });

        // 3) GM picks a tile, then confirms with OK → question posts, swirl starts.
        await gm.page.locator('.tile:not(.answered):not(.disabled)').first().click();
        await gm.page.locator('[data-ref="okBtn"]').click();

        await expect(gm.page.locator('.question-viewer')).toBeVisible();
        await expect(player.locator('.question-viewer')).toBeVisible({ timeout: 15_000 });
        // Let a couple of swirl frames render.
        await gm.page.waitForTimeout(900);
        await gm.page.screenshot({ path: 'screenshots/09-question-gm.png' });
        await player.screenshot({ path: 'screenshots/10-question-player.png' });

        // 4) Player buzzes → appears in the queue, GM can adjudicate.
        await player.locator('[data-ref="buzzBtn"]').click();
        await expect(gm.page.locator('.buzz-entry')).toContainText('Sam', { timeout: 10_000 });
        await gm.page.screenshot({ path: 'screenshots/11-buzz-gm.png' });

        // 5) GM shows the answer.
        await gm.page.locator('[data-ref="showAnswerBtn"]').click();
        await expect(gm.page.locator('.answer-text')).toBeVisible();
        await gm.page.screenshot({ path: 'screenshots/12-answer-gm.png' });
    } finally {
        // Best-effort cleanup: end the game from the live tray.
        const end = gm.page.locator('[data-ref="gmEndBtn"]');
        if (await end.count()) {
            await end.click().catch(() => {});
            await gm.page.locator('.pt-modal .pt-m-btn', { hasText: 'End game' })
                .click({ timeout: 4000 }).catch(() => {});
        }
        await context.close();
    }
});
