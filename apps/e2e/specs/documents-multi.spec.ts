import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';

const text = (name: string, body: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(body) });

test('several documents upload at once and every one is still listed after leaving the tab (T-094 B1, B2)', async ({ page }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  await page.goto(`/deals/${dealId}/documents`);
  await page.getByLabel('Choose documents').setInputFiles([
    text('01-kpi-pack.txt', 'Board KPI pack (synthetic). ARR is 7.2 million.'),
    text('02-msa.txt', 'Master services agreement (synthetic). Clause 14: change of control.'),
    text('03-balance-sheet.txt', 'Balance sheet (synthetic). Term loan 1.2 million.'),
  ]);
  const files = page.getByRole('list', { name: 'Files to upload' });
  await expect(files.getByText('Ready to upload')).toHaveCount(3);
  await page.getByRole('button', { name: 'Upload 3 files' }).click();
  await expect(files.getByText(/^Uploaded/)).toHaveCount(3);

  const library = page.getByRole('navigation', { name: 'Documents' });
  for (const name of ['01-kpi-pack.txt', '02-msa.txt', '03-balance-sheet.txt']) await expect(library.getByRole('link', { name: new RegExp(name) })).toBeVisible();

  // Leave and come back: nothing has disappeared.
  await page.goto(`/deals/${dealId}/sources`);
  await page.goto(`/deals/${dealId}/documents`);
  for (const name of ['01-kpi-pack.txt', '02-msa.txt', '03-balance-sheet.txt']) await expect(library.getByRole('link', { name: new RegExp(name) })).toBeVisible();
});

test('a file that cannot be uploaded says so on its own row, and the others still upload', async ({ page }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  await page.goto(`/deals/${dealId}/documents`);
  await page.getByLabel('Choose documents').setInputFiles([
    text('good.txt', 'A readable synthetic document.'),
    { name: 'old-workbook.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('not really a workbook') },
  ]);
  const files = page.getByRole('list', { name: 'Files to upload' });
  await expect(files.getByText('Upload failed')).toHaveCount(1);
  await expect(files.getByText(/Older \.xls workbooks: save as \.xlsx first/)).toBeVisible();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(files.getByText(/^Uploaded/)).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Documents' }).getByRole('link', { name: /good\.txt/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Documents' }).getByRole('link', { name: /old-workbook/ })).toHaveCount(0);
});
