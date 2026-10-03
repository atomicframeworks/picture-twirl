// tools/content/lib/browser.mjs
//
// Headless Chrome for the content tools (Playwright's Chromium — already a dev
// dependency). Its one job: screenshot each picture's SOURCE PAGE at the moment
// we take the picture — license evidence an admin can open later. It uses our
// named bot user-agent; sites that refuse it (Unsplash does) simply get no
// screenshot, and the license text we read from their page is recorded instead.
// Never used to scrape search engines.

import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { USER_AGENT } from './http.mjs';

export async function openBrowser() {
    const browser = await chromium.launch();
    const context = await browser.newContext({
        userAgent: USER_AGENT,
        viewport: { width: 1280, height: 900 },
        locale: 'en-US',
    });
    let open = 0;
    const MAX_TABS = 2;

    return {
        /** JPEG screenshot (Buffer, ~100–200 KB) of a page, or null if it refuses us / fails. */
        async screenshot(url) {
            while (open >= MAX_TABS) await new Promise(r => setTimeout(r, 150));
            open++;
            const page = await context.newPage();
            try {
                const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
                if (!res || res.status() >= 400) return null;
                await page.waitForTimeout(1500);
                const png = await page.screenshot({ type: 'png' });
                return sharp(png).jpeg({ quality: 70 }).toBuffer();
            } catch {
                return null;
            } finally {
                open--;
                await page.close().catch(() => {});
            }
        },
        close: () => browser.close(),
    };
}
