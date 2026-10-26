import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';
import { importPackExtract } from '../support/imports';

test('a hotel STR benchmark imports and drafts the widening RevPAR gap', async ({ page }) => {
  const dealId = await startPact(page, 'Hotels & hospitality');
  await importPackExtract(page, dealId, 'STR benchmark', demoFile('hotels', 'USD', 'str-benchmark.csv'), 12);
  await importPackExtract(page, dealId, 'Operating history', demoFile('hotels', 'USD', 'operating-history.csv'), 24);

  await page.goto(`/deals/${dealId}/findings`);
  await expect(page.getByRole('link', { name: 'RevPAR trailing the competitive set' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Seasonal demand' })).toBeVisible();
});
