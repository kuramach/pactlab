import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';
import { REPO } from '../support/env';
import { importPackExtract } from '../support/imports';

const CASE = join(REPO, 'demo-data/cases/case-01-grocery');

// T-091/T-092: Case 1's footprint and package go in through Sources; one cited entry; the screen and workbench show the planted defects.
test('the regulatory screen reads Case 1 and records its drafts', async ({ page }) => {
  test.setTimeout(180_000);
  const dealId = await startPact(page, 'Software & SaaS');
  await importPackExtract(page, dealId, 'Site footprint', join(CASE, 'sites.csv'), 4628);
  await importPackExtract(page, dealId, 'Divestiture package', join(CASE, 'remedy-package.csv'), 579);

  await page.goto(`/deals/${dealId}/documents`);
  await page.getByLabel('Choose documents').setInputFiles(join(CASE, 'merger-agreement.md'));
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Files to upload' }).getByText(/^Uploaded/)).toBeVisible();

  await page.goto(`/deals/${dealId}/regulatory`);
  await expect(page.getByRole('heading', { name: /Pre-screen: 78 of 100 overlapping local markets meet the 2023 Merger Guidelines presumption/ })).toBeVisible();
  await expect(page.getByText('Overlap pockets in 78 local markets').first()).toBeVisible();
  await expect(page.getByText(/Labor-market overlap in 78 markets/).first()).toBeVisible();
  await expect(page.getByText('Divestiture package scores 29/100 for coherence').first()).toBeVisible();

  // Cite the agreement's divestiture cap: the headroom check needs it.
  const terms = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Agreement certainty terms$/ }) });
  await terms.locator('summary').click();
  await terms.getByLabel('Signed on (YYYY-MM-DD)').fill('2022-10-14');
  await terms.getByLabel('Outside date (YYYY-MM-DD)').fill('2025-01-14');
  await terms.getByLabel(/^Efforts:/).fill('REASONABLE_BEST_EFFORTS');
  await terms.getByLabel('Divestiture cap (sites)').fill('650');
  await terms.getByLabel('Currency').fill('USD');
  await terms.getByLabel('Termination fee').fill('600000000');
  await terms.getByLabel(/^Fee payer/).fill('ACQUIRER');
  await terms.getByLabel('Cited passage').fill('Meridian shall not be required to divest more than 650 stores');
  await terms.getByRole('button', { name: 'Add agreement certainty terms' }).click();
  await expect(page.getByText('Entry added, with its citation.')).toBeVisible();
  await expect(page.getByText('Package leaves 71 sites of divestiture headroom unused').first()).toBeVisible();
  await expect(page.getByText('GO — with the remedy priced').first()).toBeVisible();
  await expect(page.getByText(/USD 600,000,000/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Add to findings register' }).click();
  await expect(page.getByText(/Recorded in the findings register: \d+ new draft/)).toBeVisible();
  await page.goto(`/deals/${dealId}/findings`);
  await expect(page.getByText('Termination fee exposure if clearance fails').first()).toBeVisible();
});
