import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';
import { importPackExtract } from '../support/imports';

test('a telecom subscriber extract maps to subscriber fields and imports every row', async ({ page }) => {
  const dealId = await startPact(page, 'Telecom & media');
  await importPackExtract(page, dealId, 'Subscribers by month', demoFile('telecom-media', 'USD', 'subscribers-by-month.csv'), 144);
  await expect(page.getByRole('status')).toContainText('Industry checks ran on them');
  await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/sources\\?imported=TELECOM_SUBSCRIBERS`));
});
