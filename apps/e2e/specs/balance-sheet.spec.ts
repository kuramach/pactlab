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
  await card.getByRole('button', { name: 'Record item' }).click();
  await expect(page.getByText('Term loan — Lakeside Bank (synthetic)', { exact: true })).toBeVisible();
  await expect(page.getByText('loan-agreement.txt, p. 1')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Term loan — Lakeside Bank (synthetic)', { exact: true })).toBeVisible();
});
