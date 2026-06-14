// tests/create.spec.js — screenshots of the create-game wizard (no fixture needed)
import { test, expect } from '@playwright/test';

test('create wizard: home → details → set → ready', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#newGameBtn')).toBeEnabled({ timeout: 15_000 });
    await page.screenshot({ path: 'screenshots/01-home.png' });

    await page.locator('#newGameBtn').click();
    await page.locator('#gmName').fill('Test GM');
    await page.locator('#gameName').fill('E2E Game');
    await page.locator('#teamAName').fill('Red');
    await page.locator('#teamBName').fill('Blue');
    await page.screenshot({ path: 'screenshots/02-create-step1.png' });

    await page.locator('#step1NextBtn').click();
    await expect(page.locator('#setList .set-card').first()).toBeVisible();
    await page.locator('#setList .set-card').first().click();
    await page.screenshot({ path: 'screenshots/03-create-step2.png' });

    await page.locator('#step2NextBtn').click();
    await expect(page.locator('#gameReady')).toBeVisible();
    await expect(page.locator('#readyGameCode')).toHaveText(/[A-Z0-9]{4,}/);
    await page.screenshot({ path: 'screenshots/04-game-ready.png' });
});
