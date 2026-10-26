import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';
import { importPackExtract } from '../support/imports';

test('a pharma patent schedule maps to patent fields and imports every family', async ({ page }) => {
  const dealId = await startPact(page, 'Pharma & biotech');
  await importPackExtract(page, dealId, 'Patent schedule', demoFile('pharma-biotech', 'USD', 'patent-schedule.csv'), 4);
  await importPackExtract(page, dealId, 'Pipeline', demoFile('pharma-biotech', 'USD', 'pipeline.csv'), 2);
  await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/sources\\?imported=PHARMA_PIPELINE`));
});
