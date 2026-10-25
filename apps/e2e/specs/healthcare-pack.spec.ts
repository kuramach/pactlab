import { expect, test } from '@playwright/test';
import { demoFile, startPact } from '../support/deals';
import { importPackExtract } from '../support/imports';

test('a healthcare provider roster imports and drafts the expiring-credentials finding', async ({ page }) => {
  const dealId = await startPact(page, 'Healthcare & health tech');
  await importPackExtract(page, dealId, 'Claims summary', demoFile('healthcare', 'USD', 'claims-summary.csv'), 72);
  await importPackExtract(page, dealId, 'Provider roster', demoFile('healthcare', 'USD', 'provider-roster.csv'), 18);
  await expect(page.getByRole('status')).toContainText('Industry checks ran on them');

  await page.goto(`/deals/${dealId}/findings`);
  const finding = page.getByRole('link', { name: 'Provider credentials expiring' });
  await expect(finding).toBeVisible();
  await finding.click();
  await expect(page.getByRole('heading', { name: 'Provider credentials expiring' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'open evidence' })).toHaveCount(2);
});
