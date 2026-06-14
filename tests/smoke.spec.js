import { test, expect } from '@playwright/test';

// Validates the whole chain: browser launches, dev server boots, Firebase
// initializes from .env.local, anonymous auth completes, and Home renders.
test('home screen loads and entry buttons enable after auth', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

    await page.goto('/');

    const newGame = page.locator('#newGameBtn');
    await expect(newGame).toBeVisible();
    // boot.js disables entry buttons until anon auth is ready, then enables them.
    await expect(newGame).toBeEnabled({ timeout: 15_000 });
    await expect(page.locator('#joinGameBtn')).toBeEnabled();

    await page.screenshot({ path: 'screenshots/home.png' });

    // If Firebase config is missing/invalid, boot alerts "Initialization failed".
    expect(dialogs.join(' ')).not.toContain('Initialization failed');
});
