import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';

test('a billing export uploads, maps, validates and imports; importing again changes nothing', { tag: '@regression' }, async ({ page }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  const file = demoFile('software-saas', 'USD', 'invoice-lines.csv');

  const upload = async () => {
    await page.goto(`/deals/${dealId}/sources/upload`);
    await page.getByRole('radio', { name: /Pactlab standard template/ }).check();
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByRole('button', { name: 'Upload and map columns' }).click();
    await expect(page.getByText('2. Map columns to the standard invoice line')).toBeVisible();
    await page.getByRole('button', { name: 'Check every row' }).click();
    await expect(page.getByText('3. Validation report')).toBeVisible();
    await expect(page.getByText(/302 of 302 lines are ready to import/)).toBeVisible();
    await page.getByRole('button', { name: 'Import 302 lines' }).click();
    await expect(page).toHaveURL(/\/sources\?imported=BILLING_INVOICE_LINE/);
  };

  await upload();
  await expect(page.getByRole('status')).toContainText('302 new records, 0 already known');
  await expect(page.getByRole('status')).toContainText('Finances now include them');

  await upload();
  await expect(page.getByRole('status')).toContainText('already imported with the same mapping. Nothing changed.');

  // Read wrongly? Delete it from the list and import it again (Kumar, 2026-11-25).
  await page.getByRole('link', { name: 'Delete invoice-lines.csv' }).first().click();
  await page.getByLabel('Why are you deleting it?').fill('Columns read wrongly');
  await page.getByRole('button', { name: 'Delete import' }).click();
  await expect(page.getByRole('heading', { name: 'This import was deleted' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('302 records no longer count');
  await page.getByRole('button', { name: 'Import again' }).click();
  await expect(page.getByText('2. Map columns to the standard invoice line')).toBeVisible();
});
