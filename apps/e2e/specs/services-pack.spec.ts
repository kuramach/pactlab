import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';
import { importPackExtract } from '../support/imports';

test('professional-services headcount imports as aggregates and drafts the attrition finding', async ({ page }) => {
  const dealId = await startPact(page, 'Professional services');
  await importPackExtract(page, dealId, 'Headcount movements', demoFile('professional-services', 'USD', 'headcount-movements.csv'), 24);
  await expect(page.getByRole('status')).toContainText('Industry checks ran on them');

  await page.goto(`/deals/${dealId}/findings`);
  await page.getByRole('link', { name: 'Rising attrition in delivery roles' }).click();
  await expect(page.getByText('Monthly delivery leavers rose from 1 in October 2025 to 4 in September 2026')).toBeVisible();
});
