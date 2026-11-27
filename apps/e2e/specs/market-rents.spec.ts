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

// T-183, T-185: twenty years of occupancy and rent on Home (the History strip, the last ten years) and on Finances
// (every year side by side, the table scrolling), and the year the business started saved there.
test('a multifamily pact reads twenty years of occupancy: the History strip, the scrolling years table and the history start', { tag: '@regression' }, async ({ page }) => {
  const dealId = await startPact(page, 'Multifamily');
  await importPackExtract(page, dealId, 'Occupancy and rent history', demoFile('multifamily', 'USD', 'occupancy-history.csv'), 240);

  await page.goto(`/deals/${dealId}`);
  await expect(page.getByText('Occupancy, average (latest year)')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Occupancy, average (latest year), by year' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Average in-place rent (latest year), by year' })).toBeVisible();
  await expect(page.getByText('FY2007–FY2026 (20 years)').first()).toBeVisible();
  await expect(page.getByText('The last 10 years shown; every year is in the years table on Finances.').first()).toBeVisible();
  // No operating statements yet: the seller is asked for the years, never a figure filled in.
  await expect(page.getByText('No operating statements imported yet: ask the seller for FY2022–FY2026 operating statements, or tell us the business started later').first()).toBeVisible();

  await page.goto(`/deals/${dealId}/finances`);
  await expect(page.getByRole('heading', { name: 'Every year read (20)' })).toBeVisible();
  const table = page.getByRole('table', { name: /The years side by side/ });
  await expect(table.getByRole('columnheader', { name: 'FY2007' })).toBeVisible();
  const latest = table.getByRole('columnheader', { name: 'FY2026' });
  await latest.scrollIntoViewIfNeeded();
  await expect(latest).toBeInViewport();
  await expect(table.getByRole('row', { name: /Occupancy \(average\)/ })).toContainText('%');
  await expect(page.getByRole('heading', { name: 'Over the full history' })).toBeVisible();
  await expect(page.getByText('Occupancy (average), worst year')).toBeVisible();

  // The year the business started: saved once; years before it are never asked for.
  await page.getByLabel('What’s the first year this business traded?').fill('2007');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('History start saved. Years before it are no longer asked for.')).toBeVisible();
  await expect(page.getByText('Set to 2007: years before it are never asked for.')).toBeVisible();
});
