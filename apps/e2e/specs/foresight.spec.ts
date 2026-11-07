import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';

// AI is off in browser tests and published forecasts come from fixture series (T-094 B10).
test('Foresight opens with published forecasts, no Generate button, and says what AI would add', async ({ page }) => {
  const dealId = await startPact(page, 'Multifamily');
  await page.goto(`/deals/${dealId}`);
  await page.getByRole('navigation', { name: 'Deal sections' }).getByRole('link', { name: 'Valuation' }).click();
  await page.getByRole('navigation', { name: 'Valuation sections' }).getByRole('link', { name: 'Foresight' }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/foresight`));
  await expect(page.getByText('not a prediction').first()).toBeVisible();

  // The baseline fills in the background; the page updates by itself.
  const metrics = page.getByRole('region', { name: 'Key metric forecasts' });
  await expect(metrics.getByRole('link', { name: 'Synthetic macro forecast (fixture)' }).first()).toBeVisible({ timeout: 20_000 });
  await expect(metrics.getByText('Inflation (consumer prices)')).toBeVisible();
  await expect(metrics.getByText('Market rent growth', { exact: true })).toBeVisible();
  // Your line is a chart you drag (batch 1), and you can add metrics of your own.
  await expect(metrics.getByRole('slider').first()).toBeVisible();
  await expect(metrics.getByText('+ Add a metric')).toBeVisible();
  await expect(page.getByText('AI is off in this environment: AI forecasts appear once it is switched on.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Generate/ })).toHaveCount(0);
});

test('your own forecast is saved and changes only the value under yours', async ({ page }) => {
  const dealId = await startPact(page, 'Multifamily');
  // An asking price gives today's value to project from.
  await page.goto(`/deals/${dealId}/valuation`);
  await page.getByPlaceholder('25,000,000').fill('24000000');
  await page.getByRole('button', { name: /^Save as v1$/ }).click();
  await page.goto(`/deals/${dealId}/foresight`);
  const metrics = page.getByRole('region', { name: 'Key metric forecasts' });
  await expect(metrics.getByRole('link', { name: 'Synthetic macro forecast (fixture)' }).first()).toBeVisible({ timeout: 20_000 });

  const value = page.getByRole('table', { name: 'Value by forecast set' });
  const reference = await value.getByRole('row', { name: /^Published \+ AI/ }).textContent();
  expect(await value.getByRole('row', { name: /^Yours/ }).textContent()).toBe(reference?.replace('Published + AI', 'Yours'));

  // Type the numbers instead of dragging (the line's keyboard fallback).
  const rent = metrics.getByRole('region', { name: 'Market rent growth' });
  await rent.getByRole('button', { name: 'Type numbers' }).click();
  for (const input of await rent.getByLabel(/^Your Market rent growth forecast/).all()) await input.fill('6');
  await rent.getByRole('button', { name: /^Save my line/ }).click();
  await expect(page.getByText('Your forecast is saved as a new version')).toBeVisible();
  await expect(page.getByText(/v1 by /)).toBeVisible();
  // Faster rent growth than neutral: yours is now worth more than published + AI.
  expect(await value.getByRole('row', { name: /^Yours/ }).textContent()).not.toBe(reference?.replace('Published + AI', 'Yours'));
  expect(await value.getByRole('row', { name: /^Published \+ AI/ }).textContent()).toBe(reference);
});
