import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';

// T-094 B8: the software-saas demo company has synthetic code and delivery data with planted engineering findings.
test('Brightwave synthetic GitHub and Jira data load and plant the engineering findings', async ({ page }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  await page.goto(`/deals/${dealId}/sources/synthetic`);
  await page.locator('select[name="repository"]').selectOption('brightwave/platform');
  await page.locator('select[name="jiraSite"]').selectOption({ label: 'brightwave.atlassian.net (BW)' });
  await page.getByRole('button', { name: 'Connect and sync' }).click();
  await page.waitForURL(new RegExp(`/deals/${dealId}/engineering`));
  await expect(async () => {
    await page.goto(`/deals/${dealId}/findings`);
    await expect(page.getByRole('link', { name: 'Single-contributor concentration in billing/' })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000, intervals: [3_000] });
  await expect(page.getByRole('link', { name: /commits attributed to unmatched or departed identities/ })).toBeVisible();
});
