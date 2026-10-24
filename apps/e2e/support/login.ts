import { expect, type Page } from '@playwright/test';
import { latestCode } from './mail';

export const LEAD = 'lead@charlie.example';
export const REVIEWER = 'reviewer@charlie.example';

/** Sign in through the real /login page with the emailed one-time code. */
export async function signIn(page: Page, address: string): Promise<void> {
  const requested = Date.now() - 1_000;
  await page.goto('/login');
  await page.getByLabel('Work email').fill(address);
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await expect(page.getByLabel('6-digit code')).toBeVisible();
  await page.getByLabel('6-digit code').fill(await latestCode(address, requested));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
