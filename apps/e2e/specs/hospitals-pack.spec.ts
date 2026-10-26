import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';
import { importPackExtract } from '../support/imports';

test('a hospital payer mix imports and drafts the payer-concentration finding', async ({ page }) => {
  const dealId = await startPact(page, 'Hospitals');
  await importPackExtract(page, dealId, 'Payer mix', demoFile('hospitals', 'USD', 'payer-mix.csv'), 60);
  await importPackExtract(page, dealId, 'Census', demoFile('hospitals', 'USD', 'census.csv'), 48);

  await page.goto(`/deals/${dealId}/findings`);
  await page.getByRole('link', { name: 'Earnings concentrated in one payer' }).click();
  await expect(page.getByText(/Government programme A \(synthetic\) is [0-9.]+% of September 2026 net revenue/)).toBeVisible();
});
