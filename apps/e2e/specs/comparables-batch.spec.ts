import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';

/** T-111: paste rows from a spreadsheet, check them, import the ready ones, download the rest to fix. */
test('batch-load comparables by pasting spreadsheet rows', { tag: '@regression' }, async ({ page }) => {
  await startPact(page, 'Software & SaaS');
  const tag = Date.now().toString(36);
  const header = ['Kind', 'Name', 'Target', 'Acquirer', 'Date', 'Company type', 'EV', 'ARR', 'Currency', 'ARR growth %', 'Source'];
  const rows = [
    ['Precedent transaction', `Pasted deal A ${tag}`, `Target A ${tag}`, 'Synthetic Buyer', '2025-04-01', 'Software / SaaS', '24,000,000', '4,000,000', 'USD', '30', 'Synthetic press release'],
    ['Public peer', `Pasted peer B ${tag}`, `Peer B ${tag}`, '', '2025-06-30', 'Software / SaaS', '50,000,000', '10,000,000', 'USD', '15', 'Synthetic 10-K'],
    ['Precedent transaction', `Pasted bad C ${tag}`, `Target C ${tag}`, '', '2025-01-15', 'Software / SaaS', '9,000,000', '3,000,000', 'USD', '10', ''],
  ];
  await page.goto('/comparables');
  await page.getByLabel('Rows', { exact: true }).fill([header, ...rows].map((cells) => cells.join('\t')).join('\n'));
  await page.getByRole('button', { name: 'Check rows' }).click();
  await expect(page.locator('p', { hasText: '3 rows:' })).toContainText('2 ready, 1 with problems');
  await expect(page.getByRole('row').filter({ hasText: 'Source:' })).toContainText('Say where this comparable comes from');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download rows with problems' }).click();
  expect((await download).suggestedFilename()).toBe('comparables-with-problems.csv');

  await page.getByRole('button', { name: 'Import 2 ready rows' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported 2 comparables' })).toBeVisible();
  // On record: after a fresh load, the list of active comparables has both, and not the bad row.
  await page.reload();
  await expect(page.getByText(`Pasted deal A ${tag}`)).toBeVisible();
  await expect(page.getByText(`Pasted peer B ${tag}`)).toBeVisible();
  await expect(page.getByText(`Pasted bad C ${tag}`)).toHaveCount(0);
});
