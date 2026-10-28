import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';
import { uploadDocument } from '../support/documents';

// Regression for the pilot bug where a debt entry was silently not saved.
test('a debt item quotes its page, rejects a bad amount without losing input, and is saved', async ({ page }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  await uploadDocument(page, dealId, 'loan-agreement.txt', 'Loan agreement extract (synthetic).\nTerm loan outstanding: USD 120,000 at 30 September 2026.\nInterest: 7.5% fixed, maturing 2029.');

  await page.goto(`/deals/${dealId}/valuation`);
  const card = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Add an item' }) });
  await card.locator('summary').click();
  await card.getByLabel('Label').fill('Term loan — Lakeside Bank (synthetic)');
  await card.getByLabel('Amount').fill('one hundred twenty thousand');
  await card.getByLabel('As of').fill('2026-09-30');
  await card.getByLabel('Document').selectOption({ label: 'loan-agreement.txt (1 pp)' });
  await card.getByRole('spinbutton', { name: /^Page/ }).fill('1');
  await card.getByRole('button', { name: 'Show page text' }).click();
  await card.getByRole('button', { name: 'Term loan outstanding: USD 120,000 at 30 September 2026.' }).click();
  await expect(card.getByLabel('Exact quote from the page')).toHaveValue('Term loan outstanding: USD 120,000 at 30 September 2026.');
  await card.getByRole('button', { name: 'Record item' }).click();

  await expect(card.getByText('Enter the amount as a number, e.g. 450000 or 450,000.00.')).toBeVisible();
  await expect(card.getByLabel('Label')).toHaveValue('Term loan — Lakeside Bank (synthetic)');

  await card.getByLabel('Amount').fill('120,000');
  // Loan terms (pilot bug 12).
  await card.getByLabel('Lender').fill('Lakeside Bank (synthetic)');
  await card.getByLabel('Interest rate (% a year)').fill('7.5');
  await card.locator('select[name="rateType"]').selectOption('FIXED');
  await card.getByLabel('Maturity date').fill('2027-03-31');
  await card.locator('select[name="repayment"]').selectOption('AMORTIZING');
  await card.getByRole('button', { name: 'Record item' }).click();
  await expect(page.getByText('Term loan — Lakeside Bank (synthetic)', { exact: true })).toBeVisible();
  await expect(page.getByText('loan-agreement.txt, p. 1')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Term loan — Lakeside Bank (synthetic)', { exact: true })).toBeVisible();
  await expect(page.getByText('Lakeside Bank (synthetic) · 7.5 % fixed · matures 2027-03-31 · Amortizing')).toBeVisible();

  // Finances shows the debt schedule; maturity within 12 months of the as-of date is flagged.
  await page.goto(`/deals/${dealId}/finances`);
  const schedule = page.getByRole('table', { name: 'Debt schedule' });
  await expect(schedule.getByText('Term loan — Lakeside Bank (synthetic)')).toBeVisible();
  await expect(schedule.getByText('7.5 %')).toBeVisible();
  await expect(schedule.getByText('Within 12 months')).toBeVisible();
  await expect(schedule.getByText('loan-agreement.txt, p. 1')).toBeVisible();
});

test('an uploaded balance sheet is read into lines that are recorded only when confirmed (T-094 B9)', async ({ page }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  await uploadDocument(
    page,
    dealId,
    'balance-sheet-2026.txt',
    'Northwind Ltd — balance sheet at 30 September 2026 (synthetic)\nCash and cash equivalents: USD 310,000\nTrade receivables: USD 118,000\nTerm loan with Lakeshore Bank, outstanding principal: USD 450,000',
  );
  await page.goto(`/deals/${dealId}/valuation`);
  await page.getByRole('button', { name: 'Find cash and debt lines' }).click();
  const lines = page.getByRole('list', { name: 'Lines found' });
  await expect(lines.getByRole('listitem')).toHaveCount(2);
  await expect(lines.getByText('Trade receivables')).toHaveCount(0);
  await expect(page.getByLabel('Balance sheet date')).toHaveValue('2026-09-30');

  const cash = lines.getByRole('listitem').filter({ hasText: 'Cash and cash equivalents' });
  await cash.getByRole('button', { name: 'Confirm' }).click();
  await expect(cash.getByText('Recorded — now on the bridge')).toBeVisible();

  // Reading again proposes only the line not yet recorded.
  await page.reload();
  await page.getByRole('button', { name: 'Find cash and debt lines' }).click();
  await expect(page.getByRole('list', { name: 'Lines found' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Lines found' }).getByText('Term loan with Lakeshore Bank', { exact: true })).toBeVisible();
});
