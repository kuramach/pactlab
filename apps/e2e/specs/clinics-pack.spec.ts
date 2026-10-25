import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';
import { importPackExtract } from '../support/imports';

test('a clinic patient-volume extract accepts pseudonymous providers and drafts the site-retention finding', async ({ page }) => {
  const dealId = await startPact(page, 'Small clinics');
  await importPackExtract(page, dealId, 'Patient volume', demoFile('small-clinics', 'USD', 'patient-volume.csv'), 264);
  await importPackExtract(page, dealId, 'Equipment schedule', demoFile('small-clinics', 'USD', 'equipment-schedule.csv'), 4);

  await page.goto(`/deals/${dealId}/findings`);
  await expect(page.getByRole('link', { name: 'One provider carries Site 3' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Imaging equipment past its useful life' })).toBeVisible();
});
