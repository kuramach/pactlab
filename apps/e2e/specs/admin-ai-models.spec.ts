import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { REPO, serverEnv } from '../support/env';

const makeOperator = (email: string) => {
  const result = spawnSync('pnpm', ['--silent', 'ops:operator', email], { cwd: REPO, env: serverEnv(), encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
};

// T-131: an operator adds a model, it passes evaluation (fixture provider: the recorded cassettes), and is assigned to one organization.
test('an operator adds a model, evaluates it, and assigns it to one organization', { tag: '@regression' }, async ({ page }) => {
  makeOperator('lead@charlie.example');
  const suffix = randomUUID().slice(0, 8);
  const name = `E2E model ${suffix}`;
  await page.goto('/admin?tab=models');
  const models = page.getByRole('table', { name: 'AI models' });
  // The configured model was adopted at boot: evaluated, serving.
  await expect(models.getByRole('row', { name: /synthetic-fixture/ }).getByText('Evaluated: can serve')).toBeVisible();

  const add = page.getByRole('form', { name: 'Add a model' });
  await add.getByLabel('Provider').selectOption('fixture');
  await add.getByLabel('Model ID').fill(`e2e-model-${suffix}`);
  await add.getByLabel('Name').fill(name);
  await add.getByRole('button', { name: 'Add model' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Model added' })).toBeVisible();
  const row = models.getByRole('row', { name: new RegExp(name) });
  await expect(row.getByText('Not evaluated')).toBeVisible();

  await row.getByRole('button', { name: 'Run evaluation' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Evaluation started' })).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('table', { name: 'AI models' }).getByRole('row', { name: new RegExp(name) }).getByText('Evaluated: can serve')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000, intervals: [2_000] });

  // One organization: its deep reviews on the new model (no allow-list, so its other roles keep the defaults).
  await page.getByLabel('Find an organization').fill('Alpha');
  await page.getByRole('search').getByRole('button', { name: 'Search' }).click();
  await page.getByRole('list', { name: 'Matching organizations' }).getByRole('link').first().click();
  const org = page.getByRole('form', { name: "This organization's models" });
  await org.getByLabel('Deep review').selectOption({ label: name });
  await org.getByRole('button', { name: 'Save for this organization' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved for this organization' })).toBeVisible();
  await expect(page.getByRole('form', { name: "This organization's models" }).getByLabel('Deep review')).toHaveValue(/[0-9a-f-]{36}/);

  // Put it back: the organization on the defaults, the model retired.
  await page.getByRole('form', { name: "This organization's models" }).getByLabel('Deep review').selectOption({ label: 'Platform default' });
  await page.getByRole('form', { name: "This organization's models" }).getByRole('button', { name: 'Save for this organization' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved for this organization' })).toBeVisible();
  await page.getByRole('table', { name: 'AI models' }).getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'Retire' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Model retired' })).toBeVisible();
});
