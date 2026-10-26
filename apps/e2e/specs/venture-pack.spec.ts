import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';
import { importPackExtract } from '../support/imports';

test('a founder imports the cap table and sees the SAFE stack before an investor does', async ({ page }) => {
  const dealId = await startPact(page, 'Venture Raise');
  await importPackExtract(page, dealId, 'Cap table', demoFile('venture-raise', 'USD', 'cap-table.csv'), 9);
  await expect(page.getByRole('status')).toContainText('Industry checks ran on them');

  await page.goto(`/deals/${dealId}/findings`);
  await page.getByRole('link', { name: 'SAFE stack converts into more than expected' }).click();
  await expect(page.getByText(/SAFE-1 has a most-favoured-nation clause, so it takes SAFE-3's cap/)).toBeVisible();
});

test('two investors bid; the founder compares them and shares an investor view with nothing confidential', async ({ page }) => {
  const dealId = await startPact(page, 'Venture Raise');
  await importPackExtract(page, dealId, 'Cap table', demoFile('venture-raise', 'USD', 'cap-table.csv'), 9);

  await page.goto(`/deals/${dealId}/raise`);
  await page.getByLabel('Your ask (pre-money)').fill('10,000,000');
  await page.getByLabel('Raising').fill('2,000,000');
  await page.getByRole('button', { name: 'Save round' }).click();
  await expect(page.getByRole('status')).toContainText('Round saved.');

  for (const [name, type, preMoney, amount] of [
    ['Harborline Ventures (synthetic)', 'VC', '10000000', '2000000'],
    ['Northfield Angels (synthetic)', 'ANGEL', '8000000', '1000000'],
  ] as const) {
    await page.getByLabel('Investor (firm or fund)').fill(name);
    await page.getByLabel('Investor type').selectOption(type);
    await page.getByLabel('Pre-money (USD)').fill(preMoney);
    await page.getByLabel('Amount (USD)').fill(amount);
    await page.getByRole('button', { name: 'Record offer' }).click();
    await expect(page.getByRole('status')).toContainText('Offer recorded.');
  }

  await expect(page.getByText(/so existing holders pay for it: founders end [0-9.]+ points lower/).first()).toBeVisible();
  await expect(page.getByText('SAFE-1 converts at its cap', { exact: false }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Investor view for Harborline Ventures (synthetic)' }).click();
  await expect(page.getByText('Safe to share')).toBeVisible();
  await expect(page.getByText('Prepared for Harborline Ventures (synthetic)')).toBeVisible();
  await expect(page.getByText('Northfield Angels')).toHaveCount(0);
  await expect(page.getByText('SAFE stack converts into more than expected')).toHaveCount(0);
});
