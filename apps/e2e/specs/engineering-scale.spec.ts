import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';

// @slow: syncs ScaleCo (3,000 engineers, tens of thousands of records). Runs in the promotion suite (e2e-full), not on every PR.
test('the Engineering tab stays usable at 3,000 engineers', { tag: '@slow' }, async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const dealId = await startPact(page, 'Software & SaaS');
  await page.goto(`/deals/${dealId}/sources/synthetic`);
  await page.locator('select[name="repository"]').selectOption('scaleco/monorepo');
  await page.locator('select[name="jiraSite"]').selectOption({ label: 'scaleco.atlassian.net (SC)' });
  await page.getByRole('button', { name: 'Connect and sync' }).click();
  await page.waitForURL(new RegExp(`/deals/${dealId}/engineering`));
  // The worker syncs both sources in the background; reload until every engineer is in.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/^\d{4} people$/)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 14 * 60_000, intervals: [5_000] });

  // Every engineer is counted; the map drops labels and offers search instead.
  await expect(page.getByText('Labels are off at this team size')).toBeVisible();
  await expect(page.getByText(/^\d{4} people$/)).toBeVisible();
  await page.getByLabel('Find a person on the map').fill('Contributor 42');
  await expect(page.getByText('no match')).toHaveCount(0);

  // The details table pages; the keep list shows the first 20 with a way to see all.
  await page.getByText('Details for each person').click();
  await expect(page.getByText(/^1–50 of \d{4}$/)).toBeVisible();
  await page.getByRole('link', { name: 'Next' }).click();
  await expect(page.getByText(/^51–100 of \d{4}$/)).toBeVisible();

  // The network shows areas and their owners, not 3,000 circles.
  await page.goto(`/deals/${dealId}/engineering?people=network#people`);
  await expect(page.getByText(/people: showing the code areas and the people who own them/)).toBeVisible();
});
