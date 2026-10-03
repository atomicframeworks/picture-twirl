// tests/admin.spec.js — the /admin app in a real browser (PROPOSAL.md §5):
// sign-in, dashboard, boards table (filters, search, bulk), creating and
// editing a board (pictures, answers, reordering, undo, autosave), the publish
// gate, rights in the tile drawer, and "published boards show up in the game".
// Runs against the isolated e2e server (fresh local database every run).
import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { normalizeImage } from '../tools/content/lib/images.mjs';

const PASSWORD = 'dev-admin-password';     // .dev.vars.example
test.use({ viewport: { width: 1440, height: 950 }, isMobile: false, hasTouch: false }); // admins use desktops

/** A distinct PNG for a file chooser / paste. */
const pngFor = (seed) => sharp({
    create: { width: 640 + seed, height: 480, channels: 3, background: { r: (seed * 70) % 255, g: (seed * 30) % 255, b: 180 } },
}).png().toBuffer();

async function signIn(page, name = 'E2E Admin') {
    await page.goto('/admin/');
    await page.locator('#adm-login-name').fill(name);
    await page.locator('#adm-login-password').fill(PASSWORD);
    await page.locator('.adm-login-card button[type=submit]').click();
    await expect(page.locator('.adm-top')).toBeVisible();
}

/** Create a COMPLETE board through the API (uploads 3 pictures, fills 5×5). */
async function apiReadyBoard(page, title, license = 'cc0') {
    const ids = [];
    for (let i = 0; i < 3; i++) {
        const img = await normalizeImage(await pngFor(100 + i + title.length));
        const res = await page.request.post('/api/admin/images', {
            multipart: {
                display: { name: 'display.webp', mimeType: 'image/webp', buffer: img.display.bytes },
                thumb: { name: 'thumb.webp', mimeType: 'image/webp', buffer: img.thumb.bytes },
                meta: JSON.stringify({ provider: 'upload', license }),
            },
        });
        expect(res.ok()).toBeTruthy();
        ids.push((await res.json()).image.id);
    }
    const created = await page.request.post('/api/admin/boards', { data: { title, emoji: '🧪' } });
    expect(created.status()).toBe(201);
    const { board } = await created.json();
    const draft = {
        points: [100, 200, 300, 400, 500],
        categories: Array.from({ length: 5 }, (_, c) => ({
            title: `Cat ${c + 1}`,
            tiles: Array.from({ length: 5 }, (_, r) => ({ answer: `${title} ${c}${r}`, imageId: ids[(c + r) % 3], notes: '' })),
        })),
    };
    const saved = await page.request.put(`/api/admin/boards/${board.id}`, { data: { rev: 1, draft } });
    expect(saved.ok()).toBeTruthy();
    return board;
}

const uniq = (prefix) => `${prefix} ${Date.now().toString(36).slice(-5)}`;

test('sign-in: wrong password is refused; right one opens the dashboard; sign out', async ({ page }) => {
    await page.goto('/admin/');
    await page.locator('#adm-login-name').fill('E2E Admin');
    await page.locator('#adm-login-password').fill('not-it');
    await page.locator('.adm-login-card button[type=submit]').click();
    await expect(page.locator('.adm-login-error')).toHaveText('Wrong password.');

    await page.locator('#adm-login-password').fill(PASSWORD);
    await page.locator('.adm-login-card button[type=submit]').click();
    await expect(page.locator('.adm-stats')).toBeVisible();
    await expect(page.locator('[data-testid=stat-published] .adm-stat-num')).toHaveText(/\d+/);
    await expect(page.locator('.adm-user')).toContainText('E2E Admin');
    await page.screenshot({ path: 'screenshots/20-admin-dashboard.png' });

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.locator('#adm-login-password')).toBeVisible();
    await page.reload();                                      // cookie really cleared
    await expect(page.locator('#adm-login-password')).toBeVisible();
});

test('create + edit a board: names, picture upload, answer, autosave, reorder, undo', async ({ page }) => {
    await signIn(page);
    const title = uniq('E2E Edit');

    // New board dialog (live name check) → lands in the editor.
    await page.goto('/admin/#/boards');
    await page.getByRole('button', { name: '+ New board' }).click();
    await page.locator('#adm-new-title').fill(title);
    await expect(page.locator('.adm-field-hint')).toHaveText('✓ Name is free');
    await page.getByRole('button', { name: 'Create board' }).click();
    await expect(page.locator('.ed-title')).toHaveValue(title);
    await expect(page.locator('.ed-check-bad')).toContainText('to finish before publishing');

    // Category name + a picture (file chooser) + an answer → autosaves.
    await page.locator('.ed-col[data-cat="0"] .ed-col-title').fill('Snacks');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-testid="tile-0-0"] .ed-pic').click();
    await (await chooser).setFiles({ name: 'cookie.png', mimeType: 'image/png', buffer: await pngFor(1) });
    await expect(page.locator('[data-testid="tile-0-0"] .ed-pic img')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid="tile-0-0"] .ed-answer').fill('Cookie');
    await page.locator('[data-testid="tile-0-1"] .ed-answer').fill('Bagel');
    await expect(page.locator('[data-testid=save-state]')).toHaveText('✓ Saved', { timeout: 10_000 });

    // Reorder: move "Cookie" (100) down to 200 → Bagel becomes the 100.
    await page.locator('[data-testid="tile-0-0"]').getByRole('button', { name: /Move .* down/ }).click();
    await expect(page.locator('[data-testid="tile-0-0"] .ed-answer')).toHaveValue('Bagel');
    await expect(page.locator('[data-testid="tile-0-1"] .ed-answer')).toHaveValue('Cookie');
    await expect(page.locator('[data-testid="tile-0-1"] .ed-pic img')).toBeVisible();   // picture moved with it

    // Move the whole category right.
    await page.getByRole('button', { name: 'Move category 1 right' }).click();
    await expect(page.locator('.ed-col[data-cat="1"] .ed-col-title')).toHaveValue('Snacks');

    // Undo (⌘/Ctrl+Z outside text fields) puts it back.
    await page.locator('.ed-head-foot').click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.ed-col[data-cat="0"] .ed-col-title')).toHaveValue('Snacks');
    await expect(page.locator('[data-testid=save-state]')).toHaveText('✓ Saved', { timeout: 10_000 });
    await page.screenshot({ path: 'screenshots/21-admin-editor.png' });

    // Everything persisted: reload and check.
    await page.reload();
    await expect(page.locator('.ed-col[data-cat="0"] .ed-col-title')).toHaveValue('Snacks');
    await expect(page.locator('[data-testid="tile-0-0"] .ed-answer')).toHaveValue('Bagel');
    await expect(page.locator('[data-testid="tile-0-1"] .ed-answer')).toHaveValue('Cookie');
    await expect(page.locator('.adm-ready-text').first()).toHaveText('1/25');      // only Cookie has a picture
});

test('paste a picture onto the tile under the mouse', async ({ page }) => {
    await signIn(page);
    const { board } = await (await page.request.post('/api/admin/boards', { data: { title: uniq('E2E Paste') } })).json();
    await page.goto(`/admin/#/boards/${board.id}`);
    await page.locator('[data-testid="tile-2-3"]').hover();
    const b64 = (await pngFor(9)).toString('base64');
    await page.evaluate(async (data) => {                      // runs in the browser
        const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
        const dt = new globalThis.DataTransfer();
        dt.items.add(new File([blob], 'pasted.png', { type: 'image/png' }));
        globalThis.document.dispatchEvent(new globalThis.ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    }, b64);
    await expect(page.locator('[data-testid="tile-2-3"] .ed-pic img')).toBeVisible({ timeout: 15_000 });
});

test('publish gate, then publish → the board is in the game’s “Pick a Board” list', async ({ page }) => {
    await signIn(page);
    const title = uniq('E2E Publish');
    const board = await apiReadyBoard(page, title);

    // Remove one answer in the UI → the gate blocks and points at the tile.
    await page.goto(`/admin/#/boards/${board.id}`);
    await page.locator('[data-testid="tile-3-2"] .ed-answer').fill('');
    await expect(page.locator('[data-testid=save-state]')).toHaveText('✓ Saved', { timeout: 10_000 });
    await page.locator('[data-testid=publish]').click();
    await expect(page.locator('.adm-toast')).toContainText('Not ready yet: Cat 4 · 300: add the answer.');

    await page.locator('[data-testid="tile-3-2"] .ed-answer').fill('Fixed');
    await expect(page.locator('.ed-check-ok')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid=publish]').click();
    await expect(page.locator('.ed-head .adm-chip.is-published')).toBeVisible();
    await expect(page.locator('[data-testid=publish]')).toHaveText('Published ✓');

    // The game's create flow lists it.
    await page.goto('/');
    await expect(page.locator('#newGameBtn')).toBeEnabled({ timeout: 15_000 });
    await page.locator('#newGameBtn').click();
    await page.locator('#step1NextBtn').click();
    await expect(page.locator('#setList .set-card', { hasText: title })).toBeVisible();
});

test('rights in the tile drawer: flags explain why; saving updates the badges', async ({ page }) => {
    await signIn(page);
    const board = await apiReadyBoard(page, uniq('E2E Rights'));
    await page.goto(`/admin/#/boards/${board.id}`);
    await expect(page.locator('[data-testid="tile-0-0"] .adm-rights')).toHaveText('✅');

    await page.locator('[data-testid="tile-0-0"] .ed-pic').click();
    const drawer = page.locator('[data-testid=tile-drawer]');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: '▶ Preview twirl' }).click();
    await expect(drawer.locator('.ed-twirl-progress')).toHaveText(/\d+%|Revealed/);

    await drawer.locator('select').selectOption('cc-by-sa-4.0');
    await drawer.getByLabel('Logo / trademark').check();
    await drawer.locator('.ed-flag', { hasText: 'I checked' }).locator('input').check();
    await drawer.getByRole('button', { name: 'Save rights' }).click();
    await expect(drawer.locator('.ed-rights-status')).toContainText('Share-alike license');
    await expect(drawer.locator('.ed-rights-status')).toContainText('Logo / trademark');
    await expect(drawer.locator('.ed-rights-status')).toContainText('Reviewed by E2E Admin');
    await page.screenshot({ path: 'screenshots/22-admin-drawer.png' });

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    // Same picture is used on several tiles → all show ⚠️ now.
    await expect(page.locator('[data-testid="tile-0-0"] .adm-rights')).toContainText('⚠️');
    await expect(page.locator('.ed-head .adm-rights')).toContainText('⚠️');
});

test('boards table: filter chips, search, bulk archive and restore', async ({ page }) => {
    await signIn(page);
    const a = await apiReadyBoard(page, uniq('E2E Bulk A'));
    const b = await apiReadyBoard(page, uniq('E2E Bulk B'));

    await page.goto('/admin/#/boards');
    await page.locator('.adm-search').fill('E2E Bulk');
    const rows = page.locator('[data-testid=boards-table] tbody tr');
    await expect(rows).toHaveCount(2);

    await page.locator(`tr[data-id="${a.id}"] input[type=checkbox]`).check();
    await page.locator(`tr[data-id="${b.id}"] input[type=checkbox]`).check();
    await expect(page.locator('.adm-bulkbar')).toContainText('2 selected');
    await page.locator('.adm-bulkbar').getByRole('button', { name: /Archive/ }).click();
    await page.locator('.adm-dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.locator('.adm-toast').last()).toContainText('Archived 2');
    await expect(rows).toHaveCount(0);                         // "All" hides archived

    await page.locator('.adm-filter-chip[data-filter=archived]').click();
    await expect(rows).toHaveCount(2);
    await expect(page).toHaveURL(/status=archived/);
    await page.locator('[data-testid=boards-table] thead input[type=checkbox]').check();   // select all shown
    await page.locator('.adm-bulkbar').getByRole('button', { name: /Restore/ }).click();
    await expect(page.locator('.adm-toast').last()).toContainText('Restored 2');
    await page.locator('.adm-filter-chip[data-filter=draft]').click();
    await expect(rows).toHaveCount(2);
});
