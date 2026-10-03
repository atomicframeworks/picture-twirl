// tests/tour.spec.js — the GM lobby tour (ui/gmTour.js) shows once for a
// first-time GM and "Skip tour" dismisses it for good (game/gmOnboarding.js).
// Other specs start with the tour dismissed (fixtures.js → skipGMTour).
import { test, expect } from '@playwright/test';
import { createGameAsGM, gmGoToLobby, endGameFromLobby } from './helpers.js';

test('first-time GM sees the lobby tour and can skip it', async ({ page }) => {
    await createGameAsGM(page);
    await gmGoToLobby(page);

    const card = page.locator('.gmt-card');
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.gmt-step-chip')).toHaveText(/Step 1 of \d/);
    await page.screenshot({ path: 'screenshots/05b-gm-lobby-tour.png' });

    await page.locator('.gmt-skip-header').click();
    await expect(page.locator('.gmt-overlay')).toHaveCount(0);

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pt.gm.onboarding.v1') || '{}'));
    expect(saved.dismissed).toBe(true);

    await endGameFromLobby(page).catch(() => {});
});
