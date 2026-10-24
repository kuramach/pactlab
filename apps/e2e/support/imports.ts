import { expect, type Page } from '@playwright/test';

/** Upload a pack extract from Sources and import it with the suggested mapping. */
export async function importPackExtract(page: Page, dealId: string, label: string, file: string, rows: number): Promise<void> {
  await page.goto(`/deals/${dealId}/sources`);
  await page.getByRole('link', { name: `Upload ${label.toLowerCase()}` }).click();
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole('button', { name: 'Upload and map columns' }).click();
  await expect(page.getByText(`2. Map columns to the ${label.toLowerCase()}`)).toBeVisible();
  await page.getByRole('button', { name: 'Check every row' }).click();
  await expect(page.getByText(`${rows} of ${rows} rows are ready to import`)).toBeVisible();
  await page.getByRole('button', { name: `Import ${rows} rows` }).click();
  await expect(page.getByRole('status')).toContainText(`${label} imported: ${rows} new records`);
}
