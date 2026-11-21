import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { REPO, serverEnv } from '../support/env';

const makeOperator = (email: string) => {
  const result = spawnSync('pnpm', ['--silent', 'ops:operator', email], { cwd: REPO, env: serverEnv(), encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
};

// Admin → AI models (#251): the models in use and the scorecard's picks per job, then one organization's
// model set and put back. Adding from Bedrock needs Bedrock, which the fixture provider has not; the API
// tests cover it (ai-models.api.test.ts).
test('an operator sees the models in use and the scorecard, and sets one organization’s model', { tag: '@regression' }, async ({ page }) => {
  makeOperator('lead@charlie.example');
  await page.goto('/admin?tab=models');

  // The configured model went live at boot and serves the platform's roles.
  const inUse = page.getByRole('list', { name: 'Models in use' });
  await expect(inUse.getByRole('listitem').filter({ hasText: /Default for/ }).first()).toBeVisible();

  // The scorecard's recommendations per job, said plainly where this environment has no Bedrock.
  await expect(page.getByText('Recommended models by job')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Extraction' })).toBeVisible();
  await expect(page.getByText('This environment does not use Bedrock, so models cannot be added here.')).toBeVisible();

  // One organization: its deep reviews on a chosen model, then back on the platform default.
  await page.getByLabel('Find an organization').fill('Alpha');
  await page.getByRole('search').getByRole('button', { name: 'Search' }).click();
  await page.getByRole('list', { name: 'Matching organizations' }).getByRole('link').first().click();
  const org = page.getByRole('form', { name: "This organization's models" });
  await org.getByLabel('Deep review').selectOption({ index: 1 });
  await org.getByRole('button', { name: 'Save for this organization' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved for this organization' })).toBeVisible();
  await expect(page.getByRole('form', { name: "This organization's models" }).getByLabel('Deep review')).toHaveValue(/[0-9a-f-]{36}/);

  await page.getByRole('form', { name: "This organization's models" }).getByLabel('Deep review').selectOption({ label: 'Platform default' });
  await page.getByRole('form', { name: "This organization's models" }).getByRole('button', { name: 'Save for this organization' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved for this organization' })).toBeVisible();
  await expect(page.getByRole('form', { name: "This organization's models" }).getByLabel('Deep review')).toHaveValue('');
});
