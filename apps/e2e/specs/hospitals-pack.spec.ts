import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';
import { importPackExtract } from '../support/imports';

test('a hospital payer mix imports and drafts the payer-concentration finding', { tag: '@regression' }, async ({ page }) => {
  const dealId = await startPact(page, 'Hospitals');
  await importPackExtract(page, dealId, 'Payer mix', demoFile('hospitals', 'USD', 'payer-mix.csv'), 60);
  await importPackExtract(page, dealId, 'Census', demoFile('hospitals', 'USD', 'census.csv'), 48);

  await page.goto(`/deals/${dealId}/findings`);
  await page.getByRole('link', { name: 'Earnings concentrated in one payer' }).click();
  await expect(page.getByText(/Government programme A \(synthetic\) is [0-9.]+% of September 2026 net revenue/)).toBeVisible();
});

test('the medical-staff register imports and the Hospital tab reads it by department (T-162)', { tag: '@regression' }, async ({ page }) => {
  const dealId = await startPact(page, 'Hospitals');
  await importPackExtract(page, dealId, 'Payer mix', demoFile('hospitals', 'USD', 'payer-mix.csv'), 60);
  await importPackExtract(page, dealId, 'Medical-staff register', demoFile('hospitals', 'USD', 'medical-staff.csv'), 55);

  await page.goto(`/deals/${dealId}/hospitals`);
  await expect(page.getByRole('heading', { name: 'Medical staff' })).toBeVisible();
  await expect(page.getByText(/Orthopaedics: 7 of 7 staff share the privilege date 2026-06-30/)).toBeVisible();
});
