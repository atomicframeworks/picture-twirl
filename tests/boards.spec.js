// tests/boards.spec.js — the "Pick a Board" step reads published boards from
// the Worker API (/api/boards), not from bundled JS. PROPOSAL.md §6.
//
// Relies on the local seed (scripts/seed-local.mjs) that `npm run dev` runs:
// the internal test board "Pop Culture Icons" is published.
import { test, expect } from '@playwright/test';

/** Home → Create → Step 1 (names are prefilled) → Step 2. */
async function openPickABoard(page) {
    await page.goto('/');
    await expect(page.locator('#newGameBtn')).toBeEnabled({ timeout: 15_000 });
    await page.locator('#newGameBtn').click();
    await expect(page.locator('#step1NextBtn')).toBeEnabled();
    await page.locator('#step1NextBtn').click();
    await expect(page.locator('#createStep2')).toBeVisible();
}

test('the board list comes from /api/boards and gates Next', async ({ page }) => {
    const apiResponse = page.waitForResponse(r => r.url().endsWith('/api/boards') && r.ok());
    await openPickABoard(page);
    const { boards } = await (await apiResponse).json();
    expect(boards.length).toBeGreaterThan(0);

    await expect(page.locator('#createStep2 .section-header-title')).toHaveText('Pick a Board');
    const cards = page.locator('#setList .set-card');
    await expect(cards).toHaveCount(boards.length);

    const seeded = boards.find(b => b.slug === 'pop-icons');
    expect(seeded, 'local seed board is published').toBeTruthy();
    const card = page.locator(`#setList .set-card[data-board="${seeded.id}"]`);
    await expect(card.locator('.set-title')).toHaveText(seeded.title);
    await expect(card.locator('.set-ic')).toHaveText(seeded.emoji);

    // Next stays disabled until a board is picked.
    await expect(page.locator('#step2NextBtn')).toBeDisabled();
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#step2NextBtn')).toBeEnabled();
    await page.screenshot({ path: 'screenshots/03b-pick-a-board.png' });
});

test('a failed board list shows an error with a working retry', async ({ page }) => {
    let failNext = true;
    await page.route('**/api/boards', async route => {
        if (failNext) {
            failNext = false;
            await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
        } else {
            await route.continue();
        }
    });

    await openPickABoard(page);
    await expect(page.locator('.board-picker-status')).toContainText('Couldn’t load the boards');
    await expect(page.locator('#step2NextBtn')).toBeDisabled();

    await page.locator('.board-picker-retry').click();
    await expect(page.locator('#setList .set-card').first()).toBeVisible();
});

test('board titles from the API are rendered as text, not HTML', async ({ page }) => {
    await page.route('**/api/boards', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ boards: [{
            id: 'brd_x', slug: 'x', emoji: '🧪', rev: 1,
            title: '<img src=x onerror="window.__pwned=1">Evil', description: '<b>bold?</b>',
        }] }),
    }));

    await openPickABoard(page);
    const card = page.locator('#setList .set-card').first();
    await expect(card.locator('.set-title')).toHaveText('<img src=x onerror="window.__pwned=1">Evil');
    await expect(card.locator('.set-sub')).toHaveText('<b>bold?</b>');
    expect(await page.evaluate(() => globalThis.__pwned)).toBeUndefined();
});
