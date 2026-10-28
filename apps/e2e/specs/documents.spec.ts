import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';
import { uploadDocument } from '../support/documents';

test('a data-room document uploads, opens by page, and AI explains plainly that it is off', async ({ page }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  await uploadDocument(page, dealId, 'customer-contract.txt', 'Master subscription agreement (synthetic).\n\nThe customer may terminate for convenience on 30 days notice.');

  await page.getByRole('navigation', { name: 'Documents' }).getByRole('link', { name: /customer-contract\.txt/ }).click();
  await expect(page.getByRole('navigation', { name: 'Pages' }).first().getByText('Page 1 of 1')).toBeVisible();
  await expect(page.getByText('may terminate for convenience')).toBeVisible();

  await page.getByRole('button', { name: 'Re-run AI extraction' }).click();
  await expect(page.getByText('AI is not switched on for this environment yet.')).toBeVisible();
  await expect(page.getByText('The model call failed or timed out')).toHaveCount(0);
});
