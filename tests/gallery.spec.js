// tests/gallery.spec.js — screenshot the component gallery (no Firebase needed)
import { test, expect, devices } from '@playwright/test';

// The gallery is a desktop dev showcase. Under the suite's phone emulation
// (Pixel 7) a neighboring demo frame wins the hit-test over the modal buttons,
// so run this one spec at desktop size.
test.use({ ...devices['Desktop Chrome'] });

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
