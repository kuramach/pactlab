import { expect, test, type Page } from '@playwright/test';
import { startPact } from '../support/deals';

/** One key metric's block (batch 1): your draggable line over the published and AI lines. */
const metric = (page: Page, label: string) => page.locator('section').filter({ has: page.getByText(label, { exact: true }) });

// AI runs on the fixture provider in browser tests (T-113); published forecasts come from fixture series (T-094 B10).
test('Foresight opens with published forecasts and the AI baseline, with no Generate button', { tag: '@regression' }, async ({ page }) => {
  const dealId = await startPact(page, 'Multifamily');
  await page.goto(`/deals/${dealId}`);
  await page.getByRole('navigation', { name: 'Deal sections' }).getByRole('link', { name: 'Valuation' }).click();
  await page.getByRole('navigation', { name: 'Valuation sections' }).getByRole('link', { name: 'Foresight' }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/foresight`));
  await expect(page.getByText('not a prediction').first()).toBeVisible();

  // The baseline fills in the background; the page updates by itself.
  await expect(page.getByRole('link', { name: 'Synthetic macro forecast (fixture)' }).first()).toBeVisible({ timeout: 20_000 });
  await expect(metric(page, 'Inflation (consumer prices)')).toHaveCount(1);
  await expect(metric(page, 'Market rent growth')).toHaveCount(1);
  // With AI on, no metric says AI is off or unreachable (the reasons themselves are unit-tested: forecasts.test.ts).
  await expect(page.getByText('AI is off in this environment.')).toHaveCount(0);
  await expect(page.getByText(/couldn’t be reached/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Generate/ })).toHaveCount(0);
});

test('your own forecast is saved and changes only the value under yours', { tag: '@regression' }, async ({ page }) => {
  const dealId = await startPact(page, 'Multifamily');
  // An asking price gives today's value to project from.
  await page.goto(`/deals/${dealId}/valuation`);
  await page.getByPlaceholder('25,000,000').fill('24000000');
  await page.getByRole('button', { name: /^Save as v1$/ }).click();
  await page.goto(`/deals/${dealId}/foresight`);
  await expect(page.getByRole('link', { name: 'Synthetic macro forecast (fixture)' }).first()).toBeVisible({ timeout: 20_000 });

  // With AI on (the fixture provider), the AI forecasts arrive in the background: wait until the page has
  // them all (it refreshes itself while preparing) before comparing, so nothing changes mid-test.
  await expect(page.getByText(/Preparing the published and AI forecasts/)).toHaveCount(0, { timeout: 30_000 });
  const value = page.getByRole('table', { name: 'Value by forecast set' });
  const published = value.getByRole('row', { name: /^Published/ });
  await expect(published).toHaveCount(1);
  const reference = await published.textContent();
  expect(await value.getByRole('row', { name: /^Yours/ }).textContent()).toBe(reference?.replace(/^Published( \+ AI)?/, 'Yours'));

  // "Type numbers" swaps the draggable line for plain inputs; the values ride on the save form.
  const rent = metric(page, 'Market rent growth');
  await rent.getByRole('button', { name: 'Type numbers' }).click();
  for (const input of await rent.getByLabel(/^Your Market rent growth forecast for \d{4}, percent$/).all()) await input.fill('6');
  await rent.getByRole('button', { name: 'Save my line' }).click();
  await expect(page.getByText('Your forecast is saved as a new version')).toBeVisible();
  await expect(rent.getByText(/v1 by /)).toBeVisible();
  // Faster rent growth than neutral: yours is now worth more than published + AI.
  expect(await value.getByRole('row', { name: /^Yours/ }).textContent()).not.toBe(reference?.replace('Published + AI', 'Yours'));
  expect(await value.getByRole('row', { name: /^Published \+ AI/ }).textContent()).toBe(reference);
});
