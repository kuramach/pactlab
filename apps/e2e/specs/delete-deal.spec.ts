import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';

test('the deal lead deletes a deal from My deals after typing its name', async ({ page }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  await page.goto('/deals');
  const row = page.getByRole('row').filter({ has: page.locator(`a[href="/deals/${dealId}"]`) });
  const name = (await row.locator('span.font-bold').first().innerText()).trim();
  await row.getByRole('button', { name: `Delete ${name}` }).click();
  const dialog = page.getByRole('dialog', { name: `Delete ${name}` });
  await expect(dialog.getByRole('button', { name: 'Delete deal' })).toBeDisabled();
  await dialog.getByLabel('Type the deal name to confirm').fill(name);
  await dialog.getByRole('button', { name: 'Delete deal' }).click();
  await expect(page.locator(`a[href="/deals/${dealId}"]`)).toHaveCount(0);
  // Gone for good: opening it directly finds nothing.
  await page.goto(`/deals/${dealId}`);
  await expect(page.getByText(/No access|not found|Not found/).first()).toBeVisible();
});
