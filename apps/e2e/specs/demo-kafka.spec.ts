import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';

// T-127: the real apache/kafka repository and KAFKA project, replayed from the recorded snapshot (no live call).
test('the recorded apache/kafka and KAFKA data load into a pact as real, labelled code and delivery evidence', { tag: '@regression' }, async ({ page }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  await page.goto(`/deals/${dealId}/sources/synthetic`);
  await page.getByLabel('Repository').selectOption('apache/kafka');
  await page.getByLabel('Jira site').selectOption({ label: 'issues.apache.org (KAFKA)' });
  await page.getByRole('button', { name: 'Connect and sync' }).click();
  await page.waitForURL(new RegExp(`/deals/${dealId}/engineering`));
  await expect(async () => {
    await page.goto(`/deals/${dealId}/engineering`);
    await expect(page.getByText('Code activity')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000, intervals: [3_000] });
  await page.goto(`/deals/${dealId}/sources`);
  await expect(page.getByText('apache/kafka (real public data, recorded once)')).toBeVisible();
  await expect(page.getByText('Apache Jira (real public data, recorded once)')).toBeVisible();
});
