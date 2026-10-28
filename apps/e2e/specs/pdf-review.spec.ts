import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';
import { syntheticPdf } from '../support/pdf';

test('a PDF opens as its original page beside the review queue, with its extracted text one click away', async ({ page }) => {
  const dealId = await startPact(page, 'Fintech');
  await page.goto(`/deals/${dealId}/documents`);
  const pdf = syntheticPdf([
    ['Partner bank agreement (synthetic)', 'Clause 1. Services.'],
    ['22.3 Change of control. The Bank may terminate this', 'Agreement on thirty days notice.'],
  ]);
  await page.locator('input[type="file"]').setInputFiles({ name: 'partner-bank.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByRole('navigation', { name: 'Documents' }).getByRole('link', { name: /partner-bank\.pdf/ }).click();
  await page.getByRole('navigation', { name: 'Pages' }).first().getByRole('link', { name: 'Next page →' }).click();
  await expect(page.getByRole('navigation', { name: 'Pages' }).first().getByText('Page 2 of 2')).toBeVisible();

  const original = page.getByRole('figure', { name: 'partner-bank.pdf, page 2, as the original PDF' });
  await expect(original).toBeVisible();
  await expect(original.getByText('Original page with cited quotes highlighted.')).toBeVisible();
  const box = await original.getByRole('img', { name: 'Page 2 of partner-bank.pdf' }).boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(200);

  await page.getByText('Extracted text (what citations are checked against)').click();
  await expect(page.getByText('22.3 Change of control.')).toBeVisible();

  // The original goes through the app's own route; another deal's id is refused there too.
  const direct = await page.request.get(`/deals/${dealId}/documents/00000000-0000-7000-8000-000000000000/original`);
  expect(direct.status()).toBe(404);
});
