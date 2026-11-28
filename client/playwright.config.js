import { defineConfig, devices } from '@playwright/test';

const browser = process.env.PLAYWRIGHT_BROWSER || 'chromium';
const desktop = { chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' };
const port = process.env.PLAYWRIGHT_PORT || '5173';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: 2,
    reporter: 'list',
    use: { baseURL, trace: 'retain-on-failure' },
    projects: [{ name: browser, use: {
        ...devices[desktop[browser]],
        ...(browser === 'chromium' ? { channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium' } : {}),
        ...(process.env.PLAYWRIGHT_MOBILE === '1' ? { viewport: { width: 390, height: 844 }, hasTouch: true } : {})
    } }],
    webServer: {
        command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
    },
});
