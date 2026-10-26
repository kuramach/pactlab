import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';
import { importPackExtract } from '../support/imports';

test('e-commerce ad spend imports and drafts the paid-social acquisition-cost finding', async ({ page }) => {
  const dealId = await startPact(page, 'E-commerce & DTC');
  await importPackExtract(page, dealId, 'Ad spend', demoFile('ecommerce-dtc', 'USD', 'ad-spend.csv'), 24);
  await expect(page.getByRole('status')).toContainText('Industry checks ran on them');

  await page.goto(`/deals/${dealId}/findings`);
  await expect(page.getByRole('link', { name: 'Acquisition cost rising on paid social' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Acquisition cost rising on search' })).toHaveCount(0);
});
