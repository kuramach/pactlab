import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';
import { importPackExtract } from '../support/imports';

test('a commercial rent roll imports and drafts the below-market anchor as upside, not price', async ({ page }) => {
  const dealId = await startPact(page, 'Commercial property');
  await importPackExtract(page, dealId, 'Commercial rent roll', demoFile('commercial-property', 'USD', 'rent-roll.csv'), 11);
  await importPackExtract(page, dealId, 'CAM reconciliation', demoFile('commercial-property', 'USD', 'cam-reconciliation.csv'), 3);

  await page.goto(`/deals/${dealId}/findings`);
  await expect(page.getByRole('link', { name: 'Below-market anchor rent (upside, not price)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'CAM recoveries below expenses' })).toBeVisible();
});
