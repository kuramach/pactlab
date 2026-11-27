import { defineConfig, devices } from '@playwright/test';

/**
 * The marketing site, built for production and served through the same
 * CloudFront Function code the stack deploys (e2e/edge-server.ts). Every
 * translation is previewed so the switcher and country routing can be
 * proven before the native reviews complete.
 */
const PORT = 3110;
const ci = Boolean(process.env['CI']);

export default defineConfig({
  testDir: '.',
  testMatch: ['*.spec.ts'],
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    timezoneId: 'UTC',
    locale: 'en-US',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `sh -c "next build && node e2e/edge-server.ts ${PORT}"`,
    cwd: '..',
    url: `http://localhost:${PORT}/locales.json`,
    env: { NEXT_PUBLIC_LOCALE_PREVIEW: 'true', NEXT_PUBLIC_CONTACT_EMAIL: 'pilots@example.test', NEXT_PUBLIC_SITE_INDEXING: 'none' },
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
