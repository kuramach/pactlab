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

// T-183: five years of occupancy and rent on Home (the History strip) and on Finances (the years side by side).
test('a multifamily pact reads five years of occupancy: the History strip and the years table', { tag: '@regression' }, async ({ page }) => {
  const dealId = await startPact(page, 'Multifamily');
  await importPackExtract(page, dealId, 'Occupancy and rent history', demoFile('multifamily', 'USD', 'occupancy-history.csv'), 60);

  await page.goto(`/deals/${dealId}`);
  await expect(page.getByText('Occupancy, average (latest year)')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Occupancy, average (latest year), by year' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Average in-place rent (latest year), by year' })).toBeVisible();
  await expect(page.getByText('FY2022–FY2026 (5 of 5 years)').first()).toBeVisible();
  // No operating statements yet: the seller is asked for the years, never a figure filled in.
  await expect(page.getByText('No operating statements imported yet: ask the seller for FY2022–FY2026 operating statements').first()).toBeVisible();

  await page.goto(`/deals/${dealId}/finances`);
  await expect(page.getByRole('heading', { name: 'Five years' })).toBeVisible();
  const table = page.getByRole('table', { name: /The years side by side/ });
  await expect(table.getByRole('columnheader', { name: 'FY2022' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'FY2026' })).toBeVisible();
  await expect(table.getByRole('row', { name: /Occupancy \(average\)/ })).toContainText('%');
});
