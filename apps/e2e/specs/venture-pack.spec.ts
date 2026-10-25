import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';
import { importPackExtract } from '../support/imports';

test('a founder imports the cap table and sees the SAFE stack before an investor does', async ({ page }) => {
  const dealId = await startPact(page, 'Venture Raise');
  await importPackExtract(page, dealId, 'Cap table', demoFile('venture-raise', 'USD', 'cap-table.csv'), 9);
  await expect(page.getByRole('status')).toContainText('Industry checks ran on them');

  await page.goto(`/deals/${dealId}/findings`);
  await page.getByRole('link', { name: 'SAFE stack converts into more than expected' }).click();
  await expect(page.getByText(/SAFE-1 has a most-favoured-nation clause, so it takes SAFE-3's cap/)).toBeVisible();
});
