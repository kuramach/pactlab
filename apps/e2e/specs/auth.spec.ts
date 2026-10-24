import { expect, test } from '@playwright/test';
import { LEAD, signIn } from '../support/login';

test.describe('email-code sign-in', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a wrong code is refused with a clear message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Work email').fill(LEAD);
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('the emailed code signs in, and signing out ends the session', async ({ page }) => {
    await signIn(page, LEAD);
    await page.goto('/deals');
    await expect(page.getByRole('heading', { name: 'My deals' })).toBeVisible();
    await page.goto('/settings');
    await page.getByRole('main').getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/deals');
    await expect(page).toHaveURL(/\/login/);
  });
});
