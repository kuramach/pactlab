import { defineConfig, devices } from '@playwright/test';

/**
 * Browser checks against a deployed environment (T-113 part 5): no local servers, nobody signed in,
 * and only tests tagged @prod-safe (read-only: they write nothing and send no email).
 *   E2E_BASE_URL=https://app.pactlab.ai E2E_API_URL=https://app.pactlab.ai E2E_SITE_URL=https://pactlab.ai \
 *     pnpm --filter @pactlab/e2e test:e2e:remote
 * Signed-in journeys against a synthetic tenant come next: they need a passkey for that tenant stored
 * as a secret (a virtual authenticator signs in with it), set up once on each environment.
 */
const baseURL = process.env['E2E_BASE_URL'];
if (!baseURL) throw new Error('E2E_BASE_URL is required for a remote run (the app origin, e.g. https://app.pactlab.ai)');

export default defineConfig({
  testDir: '.',
  testMatch: ['specs/prod-safe.spec.ts'],
  grep: /@prod-safe/,
  workers: 1,
  forbidOnly: true,
  retries: 1,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['./support/flaky-reporter.ts']],
  use: { baseURL, trace: 'on-first-retry', screenshot: 'only-on-failure', timezoneId: 'UTC', locale: 'en-US' },
  projects: [{ name: 'remote', use: { ...devices['Desktop Chrome'] } }],
});
