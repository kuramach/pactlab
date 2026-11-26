import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';
import { importPackExtract } from '../support/imports';

// T-158: a multifamily pact's rent roll checked against the market (the fixture provider stands in for RentCast).
test('a multifamily pact checks its rents against the market and the figures appear', { tag: '@regression' }, async ({ page }) => {
  const dealId = await startPact(page, 'Multifamily');
  await importPackExtract(page, dealId, 'Rent roll', demoFile('multifamily', 'USD', 'rent-roll.csv'), 96);

  await page.goto(`/deals/${dealId}`);
  await expect(page.getByText('Market rent, annual (from RentCast)')).toBeVisible();
  await expect(page.getByText('Loss-to-lease (from the rent roll)')).toBeVisible();
  await expect(page.getByText('Needs market rents: Check rents against the market.').first()).toBeVisible();

  // No listing names the address: asked once, stored on the pact.
  await page.getByLabel('Property address').fill('5500 Grand Lake Dr, San Antonio, TX 78244');
  await page.getByRole('button', { name: 'Check rents against the market' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'floor plan estimates added' })).toContainText('3 floor plan estimates added');

  // The figures appear, each from RentCast and cited to its estimates.
  await expect(page.getByText('Needs market rents: Check rents against the market.')).toHaveCount(0);
  await expect(page.getByText(/Σ RentCast estimate for each occupied unit's floor plan × 12/)).toBeVisible();
  await expect(page.getByText('Source: RentCast').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'estimate 1' }).first()).toBeVisible();
  await expect(page.getByText(/retrieved \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(page.getByLabel('Property address')).toHaveCount(0);

  // The below-range check drafted a finding for review.
  await page.goto(`/deals/${dealId}/findings`);
  await expect(page.getByRole('link', { name: 'In-place rents below the market range (RentCast)' })).toBeVisible();
});
