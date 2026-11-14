import { defineConfig, devices } from '@playwright/test';
import { API_ORIGIN, AUTH_DIR, serverEnv, WEB_ORIGIN, WEB_PORT } from './support/env';

/**
 * Browser tests against a real API, web app and database (synthetic data
 * only). The API server prepares a fresh `pactlab_e2e` database first; the
 * `setup` project signs in once and every spec reuses that session.
 */
const env = serverEnv();
const ci = Boolean(process.env['CI']);

export default defineConfig({
  testDir: '.',
  testMatch: ['specs/**/*.spec.ts', 'support/*.setup.ts'],
  // One worker: every spec writes to the one e2e database through the one API (T-113 part 2 isolates
  // the data per test, which is what would let this go to 2).
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  // Retries only in CI, and only to tell a flaky test from a broken one: every pass on retry is
  // reported (support/flaky-reporter.ts) and must be quarantined or fixed (QUARANTINE.md, T-113).
  retries: ci ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: ci ? [['list'], ['html', { open: 'never' }], ['./support/flaky-reporter.ts']] : [['list'], ['./support/flaky-reporter.ts']],
  use: {
    baseURL: WEB_ORIGIN,
    // Evidence only when it is needed: a trace on the first retry, a screenshot and video of a failure.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Pinned, so a run never depends on the machine it runs on.
    timezoneId: 'UTC',
    locale: 'en-US',
  },
  projects: [
    { name: 'setup', testMatch: 'support/*.setup.ts' },
    {
      name: 'chromium',
      testMatch: 'specs/**/*.spec.ts',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: `${AUTH_DIR}/lead.json` },
    },
  ],
  webServer: [
    {
      command: 'sh support/start-api.sh',
      url: `${API_ORIGIN}/health`,
      env,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      // A production build: what users get, and it never collides with a
      // running `next dev` (which writes to .next/dev).
      command: `pnpm --filter @pactlab/web exec sh -c "next build && next start --port ${WEB_PORT}"`,
      url: `${WEB_ORIGIN}/login`,
      env,
      timeout: 300_000,
      reuseExistingServer: false,
    },
  ],
});
