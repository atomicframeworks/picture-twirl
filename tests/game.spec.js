// tests/game.spec.js — drive to the LIVE game board and screenshot the key states
import { test, expect } from './fixtures.js';
import { joinAsPlayer } from './helpers.js';

test('live game: board, question/swirl, buzz, award, reveal', async ({ gm, browser }) => {
    test.setTimeout(90_000); // two full questions over real Firebase

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

        // The question picture is served by the Worker from R2 (/media/…) and loads.
        const twirlImage = gm.page.locator('[data-ref="twirlImage"]');
        await expect(twirlImage).toHaveAttribute('src', /^\/media\/display\/[0-9a-f]{64}\.webp$/);
        await expect.poll(() => twirlImage.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);

        // 3b) Swirl timer is visible, and GM pause toggles (data-paused mirrors the label).
        await expect(gm.page.locator('.swirl-timer')).toBeVisible();
        const pauseBtn = gm.page.locator('[data-ref="pauseSwirlBtn"]');
        await pauseBtn.click();
        await expect(pauseBtn).toHaveAttribute('data-paused', 'true');
        await expect(pauseBtn.locator('.gm-icon-btn__label')).toHaveText('Resume');
        await pauseBtn.click();
        await expect(pauseBtn).toHaveAttribute('data-paused', 'false');
        await expect(pauseBtn.locator('.gm-icon-btn__label')).toHaveText('Pause');

        // 4) Player buzzes → appears in the queue, GM can adjudicate.
        await player.locator('[data-ref="buzzBtn"]').click();
        await expect(gm.page.locator('.buzz-entry')).toContainText('Sam', { timeout: 10_000 });
        await gm.page.screenshot({ path: 'screenshots/11-buzz-gm.png' });

        // 5) GM awards Team A while adjudicating the buzz → the answer is revealed
        //    for everyone, the score updates and confetti fires (celebration).
        await gm.page.locator('[data-ref="awardABtn"]').click();
        await expect(gm.page.locator('.answer-text')).toBeVisible();
        await expect(player.locator('.answer-text')).toBeVisible({ timeout: 10_000 });
        await expect(gm.page.locator('[data-ref="teamAScore"]')).toHaveText('100');
        await expect(gm.page.locator('#pt-confetti')).toHaveCount(1);
        await gm.page.waitForTimeout(400);
        await gm.page.screenshot({ path: 'screenshots/12-award-confetti.png' });

        // 6) Continue → back to the board; that tile is now answered.
        await gm.page.locator('[data-ref="backToBoardBtn"]').click();
        await expect(gm.page.locator('.question-viewer')).toBeHidden({ timeout: 10_000 });
        await expect(gm.page.locator('#board .tile.answered')).toHaveCount(1);

        // 7) Next tile: Reveal without awarding → answer shows, no points change,
        //    and the award buttons are gone in the resolved state.
        await gm.page.locator('.tile:not(.answered):not(.disabled)').first().click();
        await gm.page.locator('[data-ref="okBtn"]').click();
        await expect(gm.page.locator('.question-viewer')).toBeVisible();
        await gm.page.locator('[data-ref="showAnswerBtn"]').click();
        await expect(gm.page.locator('.answer-text')).toBeVisible();
        await expect(gm.page.locator('[data-ref="awardABtn"]')).toBeHidden();
        await expect(gm.page.locator('[data-ref="teamAScore"]')).toHaveText('100');
        await gm.page.screenshot({ path: 'screenshots/13-reveal-gm.png' });
    } finally {
        // Best-effort cleanup: end the game from whichever End control is showing
        // (the icon bar during a question, the tray link on the board).
        const end = gm.page.locator('[data-ref="gmEndInQuestion"]:visible, [data-ref="gmEndBtn"]:visible').first();
        if (await end.count()) {
            await end.click({ timeout: 4000 }).catch(() => {});
            await gm.page.locator('.pt-modal .pt-m-btn', { hasText: 'End game' })
                .click({ timeout: 4000 }).catch(() => {});
        }
        await context.close();
    }
});
