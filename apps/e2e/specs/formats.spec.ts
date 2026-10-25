import { readFileSync } from 'node:fs';
import { syntheticXlsx } from '@pactlab/connectors/xlsx-fixture';
import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The synthetic loan tape as an Excel workbook, behind a cover sheet. */
function loanTapeWorkbook(): Buffer {
  const [header, ...rows] = readFileSync(demoFile('fintech', 'USD', 'loan-tape.csv'), 'utf8').trim().split('\n').map((line) => line.split(','));
  return Buffer.from(
    syntheticXlsx([
      { name: 'Cover', rows: [['Loan tape extract (synthetic)']] },
      { name: 'Loans', rows: [header ?? [], ...rows] },
    ]),
  );
}

test('an Excel loan tape: pick the sheet, map, import', async ({ page }) => {
  const dealId = await startPact(page, 'Fintech');
  await page.getByRole('link', { name: 'Upload loan tape' }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'loan-tape.xlsx', mimeType: XLSX_TYPE, buffer: loanTapeWorkbook() });
  await page.getByRole('button', { name: 'Upload and map columns' }).click();

  // The first sheet with data is the cover; switch to the loans.
  await expect(page.getByText('Read as Excel workbook, sheet “Cover”')).toBeVisible();
  await page.getByLabel('Sheet').selectOption('Loans');
  await expect(page.getByText('Read as Excel workbook, sheet “Loans”')).toBeVisible();
  await expect(page.getByLabel('Source for Loan id')).toHaveValue('column:loan_id');
  await page.getByRole('button', { name: 'Check every row' }).click();
  await expect(page.getByText('120 of 120 rows are ready to import')).toBeVisible();
  await page.getByRole('button', { name: 'Import 120 rows' }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/sources\\?imported=FINTECH_LOAN_TAPE`));
  await expect(page.getByText('Loan tape imported: 120 new records')).toBeVisible();
});

test('an old .xls workbook is refused with how to fix it', async ({ page }) => {
  await startPact(page, 'Fintech');
  await page.getByRole('link', { name: 'Upload loan tape' }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'loan-tape.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) });
  await page.getByRole('button', { name: 'Upload and map columns' }).click();
  await expect(page.getByText('Older Excel files (.xls) are not accepted.')).toBeVisible();
});

// @slow: about a minute. Runs in the promotion suite (e2e-full), not on every PR.
test('a 20,000-line export imports in the background with visible progress', { tag: '@slow' }, async ({ page }) => {
  test.setTimeout(240_000);
  const dealId = await startPact(page, 'Software & SaaS');
  const header = 'line_id,invoice_id,customer_id,currency,amount,interval,period_start,period_end,invoice_status,created';
  const lines = Array.from({ length: 20_000 }, (_, index) => `bg_${index},in_${index},cus-${index % 400},USD,49.00,month,2026-09-01,2026-10-01,paid,2026-09-01`);
  await page.goto(`/deals/${dealId}/sources/upload`);
  await page.getByRole('radio', { name: /Pactlab standard template/ }).check();
  await page.locator('input[type="file"]').setInputFiles({ name: 'large.csv', mimeType: 'text/csv', buffer: Buffer.from(`${header}\n${lines.join('\n')}\n`) });
  await page.getByRole('button', { name: 'Upload and map columns' }).click();
  await page.getByRole('button', { name: 'Check every row' }).click();
  await expect(page.getByText('20000 of 20000 lines are ready to import')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Import 20000 lines' }).click();

  const progress = page.getByRole('status', { name: 'Import progress' });
  await expect(progress).toBeVisible();
  await expect(progress).toContainText('of 20,000 lines');
  await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/sources\\?imported=BILLING_INVOICE_LINE`), { timeout: 200_000 });
  await expect(page.getByText('Invoice lines imported: 20000 new records')).toBeVisible();
});

test('an Excel workbook in the data room: each sheet is a page', async ({ page }) => {
  const dealId = await startPact(page, 'Fintech');
  await page.goto(`/deals/${dealId}/documents`);
  await page.locator('input[type="file"]').setInputFiles({ name: 'loan-tape.xlsx', mimeType: XLSX_TYPE, buffer: loanTapeWorkbook() });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const link = page.getByRole('navigation', { name: 'Documents' }).getByRole('link', { name: /loan-tape\.xlsx/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByText('Sheet: Cover')).toBeVisible();
});
