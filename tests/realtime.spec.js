// tests/realtime.spec.js — M4 acceptance in real browsers (PROPOSAL.md §8.4):
// live games on GameRoom Durable Objects instead of Firebase.
//   • a player whose connection drops mid-question comes back seamlessly
//   • buzz order is the same on every screen
//   • swirl progress agrees across screens (one room clock)
//   • the host gets the GM seat back after closing the tab (AUDIT M15)
//   • players' browsers never receive an answer before the reveal (AUDIT M7)
import { test, expect } from './fixtures.js';
import { joinAsPlayer } from './helpers.js';

/** Players join Team B, the GM takes Team A, the GM starts → everyone on the live board. */
async function startLive(gm, players) {
    for (const p of players) {
        const joinB = p.locator('[data-ref="teamBAction"]');
        await expect(joinB).toHaveAttribute('data-action', 'join-B');
        await joinB.click();
        await expect(joinB).toHaveText('Leave');
    }
    const joinA = gm.page.locator('[data-ref="teamAAction"]');
    await expect(joinA).toHaveAttribute('data-action', 'join-A');
    await joinA.click();
    await expect(joinA).toHaveText('Leave');
    await gm.page.locator('[data-ref="gmStart"]').click();
    await expect(gm.page.locator('.game-root')).toBeVisible({ timeout: 15_000 });
    for (const p of players) await expect(p.locator('.game-root')).toBeVisible({ timeout: 15_000 });
}

/** GM opens the first open tile; returns its id ("col-row"). */
async function postQuestion(gm, players) {
    const tile = gm.page.locator('.tile:not(.answered):not(.disabled)').first();
    await expect(tile).toBeVisible({ timeout: 10_000 });     // past the starting-team coin flip
    const id = await tile.getAttribute('data-id');
    await tile.click();
    await gm.page.locator('[data-ref="okBtn"]').click();
    await expect(gm.page.locator('.question-viewer')).toBeVisible();
    for (const p of players) await expect(p.locator('.question-viewer')).toBeVisible({ timeout: 10_000 });
    return id;
}

test('a player whose connection drops mid-question comes back seamlessly', async ({ gm, browser }) => {
    test.setTimeout(60_000);
    const { context, page: sam } = await joinAsPlayer(browser, gm.gameId, 'Sam');
    try {
        await startLive(gm, [sam]);
        await postQuestion(gm, [sam]);

        // Wi-Fi off: the socket drops (not a clean close) and reconnecting fails for a while.
        await context.setOffline(true);
        await sam.evaluate(() => globalThis.PictureTwirl.realtime.simulateDrop());
        await sam.waitForTimeout(2000);
        await context.setOffline(false);

        // Back: same seat, same question, and the buzz goes through.
        await expect.poll(() => sam.evaluate(() => globalThis.PictureTwirl.realtime.stats()[0]?.connected), { timeout: 15_000 }).toBe(true);
        const stats = await sam.evaluate(() => globalThis.PictureTwirl.realtime.stats()[0]);
        expect(stats.reconnects).toBeGreaterThanOrEqual(1);
        await expect(sam.locator('.question-viewer')).toBeVisible();
        await sam.locator('[data-ref="buzzBtn"]').click();
        await expect(gm.page.locator('.buzz-entry')).toContainText('Sam', { timeout: 10_000 });
    } finally {
        await context.close();
    }
});

test('buzz order and swirl progress are the same on every screen', async ({ gm, browser }) => {
    test.setTimeout(60_000);
    const a = await joinAsPlayer(browser, gm.gameId, 'Ann');
    const b = await joinAsPlayer(browser, gm.gameId, 'Ben');
    try {
        await startLive(gm, [a.page, b.page]);
        await postQuestion(gm, [a.page, b.page]);

        // Swirl: let it run, then read every screen's progress bar (one room clock → same %).
        await gm.page.waitForTimeout(2500);
        const progress = async (p) => p.locator('[data-ref="swirlFill"]').evaluate(el => parseFloat(el.style.width) || 0);
        const [g, pa, pb] = await Promise.all([progress(gm.page), progress(a.page), progress(b.page)]);
        expect(g).toBeGreaterThan(3);
        expect(Math.abs(g - pa)).toBeLessThanOrEqual(4);
        expect(Math.abs(g - pb)).toBeLessThanOrEqual(4);

        // Both buzz at (almost) the same moment: the room's arrival order is the order everyone sees.
        await Promise.all([a.page.locator('[data-ref="buzzBtn"]').click(), b.page.locator('[data-ref="buzzBtn"]').click()]);
        const queue = (p) => p.locator('[data-ref="buzzQueueEl"] .buzz-entry').allTextContents();
        await expect.poll(() => queue(gm.page).then(q => q.length), { timeout: 10_000 }).toBeGreaterThan(0);
        await gm.page.waitForTimeout(500);
        const gmOrder = await queue(gm.page);
        expect(await queue(a.page)).toEqual(gmOrder);
        expect(await queue(b.page)).toEqual(gmOrder);
    } finally {
        await a.context.close();
        await b.context.close();
    }
});

test('the host gets the GM seat back after closing the tab (same browser)', async ({ gm }) => {
    // The GM's tab is gone; a new tab in the same browser opens the invite link.
    const code = gm.gameId;
    const tab = await gm.context.newPage();
    await gm.page.close();
    await tab.goto(`/#${code}`);
    await expect(tab.locator('#joinGameId')).toHaveValue(new RegExp(code, 'i'));
    await tab.locator('#playerName').fill('Test GM');
    await tab.locator('#confirmJoin').click();
    await expect(tab.locator('.lobby-root')).toBeVisible();
    await expect(tab.locator('.lobby-root')).toHaveClass(/is-gm/);
    await expect(tab.locator('[data-ref="gmStart"]')).toBeVisible();
    gm.page = tab;                                       // so the fixture's teardown ends the game from here
});

test('players never receive an answer before the reveal', async ({ gm, browser }) => {
    test.setTimeout(60_000);
    // Join by hand so we can listen to Sam's WebSocket from the first frame.
    const context = await browser.newContext();
    const sam = await context.newPage();
    const frames = [];
    sam.on('websocket', ws => ws.on('framereceived', f => frames.push(String(f.payload))));
    try {
        await sam.goto('/');
        await expect(sam.locator('#joinGameBtn')).toBeEnabled({ timeout: 15_000 });
        await sam.locator('#joinGameBtn').click();
        await sam.locator('#joinGameId').fill(gm.gameId);
        await sam.locator('#playerName').fill('Sam');
        await sam.locator('#confirmJoin').click();
        await expect(sam.locator('.lobby-root')).toBeVisible();

        await startLive(gm, [sam]);
        const tileId = await postQuestion(gm, [sam]);

        // The answer for that tile, from the published board (GM-only data in the game).
        const { boards } = await (await gm.page.request.get('/api/boards')).json();
        const board = await (await gm.page.request.get(`/api/boards/${boards[0].id}`)).json();
        const [c, r] = tileId.split('-').map(Number);
        const answer = board.categories[c].tiles[r].answer;
        expect(answer.length).toBeGreaterThan(1);

        await sam.waitForTimeout(500);
        expect(frames.length).toBeGreaterThan(0);
        expect(frames.filter(f => f.includes(answer))).toEqual([]);           // not in the board, not in the question

        await gm.page.locator('[data-ref="showAnswerBtn"]').click();
        await expect(sam.locator('.answer-text')).toHaveText(answer, { timeout: 10_000 });
        expect(frames.some(f => f.includes(answer))).toBe(true);              // arrives with the reveal
    } finally {
        await context.close();
    }
});
