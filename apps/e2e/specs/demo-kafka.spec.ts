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
  // T-129: the Delivery chart drills into a month's real KAFKA issues, linked out to Apache Jira.
  await page.getByRole('navigation', { name: /Issues and story points resolved per month: open one/ }).getByRole('link').last().click();
  await expect(page.getByRole('heading', { name: /Jira issues resolved/ })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Issues resolved this month' }).getByRole('link', { name: /KAFKA-\d+/ }).first()).toHaveAttribute('href', /^https:\/\/issues\.apache\.org\/jira\/browse\/KAFKA-\d+$/);
  await page.goto(`/deals/${dealId}/sources`);
  // The source's card heading (its sync run lists the same name, so plain text matches twice).
  await expect(page.getByRole('heading', { name: 'apache/kafka (real public data, recorded once)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Apache Jira (real public data, recorded once)' })).toBeVisible();
});
