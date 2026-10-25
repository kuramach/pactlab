import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';

// AI is off in browser tests: the tab must say so plainly and never present a projection as a prediction.
test('Foresight explains what it needs when AI is off', async ({ page }) => {
  const dealId = await startPact(page, 'Multifamily');
  await page.goto(`/deals/${dealId}`);
  await page.getByRole('link', { name: 'Foresight' }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/foresight`));
  await expect(page.getByRole('heading', { name: 'Foresight' })).toBeVisible();
  await expect(page.getByText('not a prediction')).toBeVisible();
  await expect(page.getByText('No trend lines yet')).toBeVisible();
  await expect(page.getByText('AI is not switched on for this environment yet; the baseline needs it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate AI baseline' })).toHaveCount(0);
});
