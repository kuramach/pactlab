import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { REPO, serverEnv } from '../support/env';
import { LEAD } from '../support/login';

/**
 * T-087: an org admin buys a pact. Without Stripe keys the local stand-in checkout sends the
 * same signed events Stripe would, through the real webhook path. Then an operator makes a
 * promo code in Admin.
 */
test('buy a pact through checkout; make a promo code in Admin', async ({ page }) => {
  await page.goto('/settings#billing');
  const card = page.locator('#billing');
  await expect(card.getByRole('heading', { name: 'Billing' })).toBeVisible();
  const left = card.getByTestId('pacts-left');
  await expect(left).toBeVisible();
  const before = await left.textContent();
  await card.getByRole('button', { name: 'Buy Pact' }).click();
  await expect(page).toHaveURL(/\/billing\/fixture-checkout\?session=cs_fixture_/);
  await page.getByRole('button', { name: 'Pay (test)' }).click();
  await expect(page).toHaveURL(/\/settings\?billing=returned/);
  await expect(card.getByText(/pact.*\(prepaid\)/)).toBeVisible();
  await expect(left).not.toHaveText(before ?? '');

  const operator = spawnSync('pnpm', ['--silent', 'ops:operator', LEAD], { cwd: REPO, env: serverEnv(), encoding: 'utf8' });
  expect(operator.status, operator.stderr).toBe(0);
  const code = `E2E-${Date.now().toString(36).toUpperCase()}`;
  await page.goto('/admin?tab=promo');
  const form = page.getByRole('form', { name: 'Create a promo code' });
  await form.getByLabel('Code', { exact: true }).fill(code);
  await form.getByLabel('Description (internal)').fill('E2E free pacts');
  await form.getByLabel('How many').fill('2');
  await form.getByLabel('Multifamily', { exact: true }).check();
  await form.getByRole('button', { name: 'Create promo code' }).click();
  await expect(page.getByText('Promo code created.')).toBeVisible();
  const row = page.getByRole('table', { name: 'Promo codes' }).getByRole('row', { name: new RegExp(code) });
  await expect(row).toContainText('2 free pacts (Multifamily)');
  await row.getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByRole('table', { name: 'Promo codes' }).getByRole('row', { name: new RegExp(code) })).toContainText('inactive');
});
