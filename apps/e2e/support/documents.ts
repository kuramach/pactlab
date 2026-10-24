import { expect, type Page } from '@playwright/test';

/** Upload a synthetic text document to a deal's data room from the Documents tab. */
export async function uploadDocument(page: Page, dealId: string, name: string, text: string): Promise<void> {
  await page.goto(`/deals/${dealId}/documents`);
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Documents' }).getByRole('link', { name: new RegExp(name) })).toBeVisible();
}
