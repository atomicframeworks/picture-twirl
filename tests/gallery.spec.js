// tests/gallery.spec.js — screenshot the component gallery (no Firebase needed)
import { test, expect } from '@playwright/test';

test('component gallery renders all sections', async ({ page }) => {
    await page.goto('/gallery.html');

    await expect(page.locator('.gallery-title')).toHaveText(/Component Gallery/);
    // Every section we defined should render.
    await expect(page.locator('.gallery-section')).toHaveCount(10);

    // Spot-check a few representative components exist and are styled.
    await expect(page.locator('.btn.primary').first()).toBeVisible();
    await expect(page.locator('.field .input').first()).toBeVisible();
    await expect(page.locator('.pill.is-me')).toBeVisible();
    await expect(page.locator('.scoreboard-card.is-a')).toBeVisible();
    await expect(page.locator('.tile.answered')).toBeVisible();

    await page.screenshot({ path: 'screenshots/gallery-full.png', fullPage: true });

    // The modal component opens from the gallery.
    await page.getByRole('button', { name: 'Open confirm…' }).click();
    await expect(page.locator('.pt-modal')).toBeVisible();
    await page.screenshot({ path: 'screenshots/gallery-modal.png' });
});
