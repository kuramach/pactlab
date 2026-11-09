import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';

/** T-110: a pact's Report button makes a versioned PDF that appears in Reports, ready to download. */
test('generate a pact report from the pact and download it from Reports', async ({ page }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  await page.goto(`/deals/${dealId}`);
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  await expect(page).toHaveURL(/\/reports\?/);
  const history = page.getByRole('table', { name: 'Report history' });
  const row = history.getByRole('row').filter({ hasText: 'Pact report' }).first();
  await expect(row).toContainText('v1');
  // Generated in the background; the page refreshes itself until it's ready.
  await expect(row).toContainText('Ready', { timeout: 30_000 });
  const download = page.waitForEvent('download');
  await row.getByRole('link', { name: /Download pact report v1/ }).click();
  expect((await download).suggestedFilename()).toMatch(/^pact-report-v1-\d{4}-\d{2}-\d{2}\.pdf$/);

  await page.getByRole('button', { name: 'Generate executive report' }).click();
  await expect(history.getByRole('row').filter({ hasText: 'Executive report' }).first()).toContainText('Ready', { timeout: 30_000 });
});
