// tests/lobby.spec.js — uses the `gm` fixture (game already created) and adds a player
import { test, expect } from './fixtures.js';
import { joinAsPlayer } from './helpers.js';

test('GM lobby shows the game code', async ({ gm }) => {
    await expect(gm.page.locator('.game-code-value')).toContainText(gm.gameId);
    await gm.page.screenshot({ path: 'screenshots/05-gm-lobby.png' });
});

test('a player can join the GM\'s game and pick a team', async ({ gm, browser }) => {
    const { context, page: player } = await joinAsPlayer(browser, gm.gameId, 'Sam');
    try {
        // Player landed in the lobby for this game.
        await expect(player.locator('.game-code-value')).toContainText(gm.gameId);

        // Player joins Team A via the inline team action.
        await player.locator('[data-ref="teamAAction"]').click();
        await player.screenshot({ path: 'screenshots/06-player-lobby.png' });

        // GM should see the player appear (a pill with their name).
        await expect(gm.page.locator('.pill', { hasText: 'Sam' })).toBeVisible({ timeout: 10_000 });
        await gm.page.screenshot({ path: 'screenshots/07-gm-lobby-with-player.png' });
    } finally {
        await context.close();
    }
});
