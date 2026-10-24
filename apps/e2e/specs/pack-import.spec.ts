import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';
import { importPackExtract } from '../support/imports';

// Regression for the pilot bug where every upload got the billing mapping screen.
test('a fintech loan tape maps to loan fields, not billing ones', async ({ page }) => {
  const dealId = await startPact(page, 'Fintech');
  await page.getByRole('link', { name: 'Upload loan tape' }).click();
  await expect(page.getByRole('heading', { name: 'Upload loan tape' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(demoFile('fintech', 'USD', 'loan-tape.csv'));
  await page.getByRole('button', { name: 'Upload and map columns' }).click();

  await expect(page.getByText('2. Map columns to the loan tape')).toBeVisible();
  await expect(page.getByLabel('Source for Loan id')).toHaveValue('column:loan_id');
  await expect(page.getByText('This export holds credit notes')).toHaveCount(0);
  await expect(page.getByText('standard invoice line')).toHaveCount(0);
  await page.getByRole('button', { name: 'Check every row' }).click();
  await expect(page.getByText('120 of 120 rows are ready to import')).toBeVisible();
  await page.getByRole('button', { name: 'Import 120 rows' }).click();

  await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/sources\\?imported=FINTECH_LOAN_TAPE`));
  await expect(page.getByRole('status')).toContainText('Loan tape imported: 120 new records');
  await expect(page.getByRole('status')).toContainText('Industry checks and metrics now read them');
});

test('fintech checks draft findings from the imported extracts, once', async ({ page }) => {
  const dealId = await startPact(page, 'Fintech');
  await importPackExtract(page, dealId, 'AML alerts', demoFile('fintech', 'USD', 'aml-alerts.csv'), 80);

  await page.goto(`/deals/${dealId}/findings`);
  await page.getByRole('button', { name: 'Run fintech checks' }).click();
  await expect(page.getByRole('status')).toContainText('Checks run: 1 new draft finding');
  const finding = page.getByRole('link', { name: 'Alerts closed without review evidence' });
  await expect(finding).toBeVisible();

  await page.getByRole('button', { name: 'Run fintech checks' }).click();
  await expect(page.getByRole('status')).toContainText('Checks run: 0 new draft findings, 1 already drafted');

  // The draft cites the imported alerts and waits for a human decision.
  await finding.click();
  await expect(page.getByRole('heading', { name: 'Alerts closed without review evidence' })).toBeVisible();
  await expect(page.getByText('24 of 80 closed transaction-monitoring alerts')).toBeVisible();
  await expect(page.getByRole('link', { name: 'open evidence' })).toHaveCount(24);
});
