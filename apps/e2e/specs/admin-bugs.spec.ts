import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { REPO, serverEnv } from '../support/env';
import { REVIEWER, signIn } from '../support/login';

const makeOperator = (email: string) => {
  const result = spawnSync('pnpm', ['--silent', 'ops:operator', email], { cwd: REPO, env: serverEnv(), encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
};

test('a bug reported from any page reaches the operator inbox; its status flows back to the reporter', async ({ page }) => {
  await page.goto('/deals');
  await page.getByRole('button', { name: 'Report a bug' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a bug' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Title').fill('Deals list sorts oddly (synthetic)');
  await dialog.getByLabel('What happened').fill('Newest deal shows last.');
  await dialog.getByLabel('Severity').selectOption('MEDIUM');
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('heading', { name: /Thanks — report PLB-\d{4} sent/ })).toBeVisible();
  const reference = (await page.getByRole('heading', { name: /Thanks — report/ }).textContent())?.match(/PLB-\d{4}/)?.[0] ?? '';
  await page.getByRole('button', { name: 'Close' }).click();

  await page.goto('/settings/bug-reports');
  const mine = page.getByRole('list', { name: 'My bug reports' });
  await expect(mine.getByText(reference)).toBeVisible();
  await expect(mine.getByText('New', { exact: true })).toBeVisible();

  // The operator console: triage it.
  makeOperator('lead@charlie.example');
  await page.goto('/admin?tab=bugs');
  await expect(page.getByLabel('Environment')).toContainText('local');
  await page.getByRole('link', { name: reference }).click();
  await expect(page.getByText('Deals list sorts oddly (synthetic)')).toBeVisible();
  await page.getByLabel('Status').selectOption('TRIAGED');
  await page.getByLabel('Internal notes (operators only)').fill('Reproduced on fixtures');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. The reporter sees the new status')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Convert to task' })).toBeVisible();
  await expect(page.getByRole('link', { name: `Download ${reference}.md` })).toBeVisible();

  await page.goto('/settings/bug-reports');
  await expect(page.getByRole('list', { name: 'My bug reports' }).getByText('Triaged', { exact: true })).toBeVisible();
  await expect(page.getByText('Reproduced on fixtures')).toHaveCount(0);
});

test.describe('a non-operator', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('cannot open the console', async ({ page }) => {
    await signIn(page, REVIEWER);
    await page.goto('/admin');
    await expect(page.getByText('Page not found')).toBeVisible();
    await expect(page.getByText('Pactlab operator console')).toHaveCount(0);
  });
});
