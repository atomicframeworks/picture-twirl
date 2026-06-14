import { defineConfig, devices } from '@playwright/test';

// E2E + screenshot suite. Boots the Vite dev server (which loads .env.local for
// Firebase config) and drives the app in a real Chromium browser.
export default defineConfig({
    testDir: './tests',
    // Screenshots/artifacts land here for visual verification.
    outputDir: './test-results',
    timeout: 30_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,        // game flow is stateful; keep it ordered
    workers: 1,
    reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
    use: {
        baseURL: 'http://localhost:3000',
        screenshot: 'only-on-failure',
        trace: 'on-first-retry',
        viewport: { width: 430, height: 880 }, // phone-ish; the app targets mobile
    },
    projects: [
        { name: 'chromium', use: { ...devices['Pixel 7'] } },
    ],
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 60_000,
    },
});
