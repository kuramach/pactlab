import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';

test('cancelling a wrong upload imports nothing and deletes the stored file', async ({ page }) => {
  const dealId = await startPact(page, 'Fintech');
  await page.getByRole('link', { name: 'Upload loan tape' }).click();
  await page.locator('input[type="file"]').setInputFiles(demoFile('fintech', 'USD', 'loan-tape.csv'));
  await page.getByRole('button', { name: 'Upload and map columns' }).click();
  const mapping = page.url();

  await page.getByRole('button', { name: 'Cancel upload' }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/sources\\?cancelled=`));
  await expect(page.getByText('Upload cancelled. Nothing was imported')).toBeVisible();

  await page.goto(mapping);
  await expect(page.getByRole('button', { name: 'Check every row' })).toHaveCount(0);
});
