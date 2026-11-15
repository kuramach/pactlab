import { expect, test } from '@playwright/test';
import { API_ORIGIN } from '../support/env';

/**
 * Read-only checks safe to run against live after every deploy (T-113 part 5), and locally in the
 * regression suite. They sign nobody in, send no email and write nothing. A failure after a live
 * deploy is a rollback decision (docs/runbooks/rollback.md), not a shrug.
 */
const api = process.env['E2E_API_URL'] ?? API_ORIGIN;
const site = process.env['E2E_SITE_URL'];

test.describe('after a deploy', () => {
  // Signed out, as in production: nobody is signed in for these checks.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the API answers its health check with a release', { tag: ['@regression', '@prod-safe'] }, async ({ request }) => {
    const response = await request.get(`${api}/health`);
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  test('the sign-in page offers its sign-in methods', { tag: ['@regression', '@prod-safe'] }, async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in to Pactlab' })).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Email me a sign-in code' })).toBeEnabled();
  });

  test('the website and its "Try it" pages load', { tag: ['@regression', '@prod-safe'] }, async ({ page }) => {
    test.skip(!site, 'Only where the site is deployed (E2E_SITE_URL).');
    await page.goto(site ?? '/');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.goto(`${site}/try`);
    await expect(page.getByRole('link').filter({ hasText: /SaaS|Software/ }).first()).toBeVisible();
  });
});
