import { strToU8, zipSync } from 'fflate';
import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';

/**
 * Document intake (T-098). AI is off in browser runs, so these walk the
 * parts that need no model: one zip in, a synthetic data room read, the
 * checklist and the request list. Classification itself is covered by the
 * API tests with a scripted model.
 */
test('a zip of the data room is unpacked and every file inside gets its own row', async ({ page }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  await page.goto(`/deals/${dealId}/documents`);
  const archive = zipSync({
    '02 Finance/Mgmt accounts FY26.txt': strToU8('Management accounts FY26 (synthetic). Revenue 4,210,000.'),
    '03 Commercial/MSA Northgate.txt': strToU8('Master services agreement with Northgate Logistics (synthetic).'),
    '03 Commercial/MSA Northgate copy.txt': strToU8('Master services agreement with Northgate Logistics (synthetic).'),
    'Board deck.pptx': strToU8('slides'),
    '__MACOSX/._MSA Northgate.txt': strToU8('x'),
  });
  await page.getByLabel('Choose documents').setInputFiles([{ name: 'Brightwave data room.zip', mimeType: 'application/zip', buffer: Buffer.from(archive) }]);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();

  const files = page.getByRole('list', { name: 'Files to upload' });
  await expect(files.getByText(/4 file\(s\) inside: 2 uploaded, 1 already here, 1 not uploaded/)).toBeVisible();
  await expect(files.getByText('02 Finance/Mgmt accounts FY26.txt')).toBeVisible();
  await expect(files.getByText('Board deck.pptx')).toBeVisible();
  await expect(files.getByText(/does not read this kind of file/)).toBeVisible();
  await expect(files.getByText('__MACOSX', { exact: false })).toHaveCount(0);

  const library = page.getByRole('navigation', { name: 'Documents' });
  await expect(library.getByRole('link', { name: /Mgmt accounts FY26\.txt/ })).toBeVisible();
  await expect(library.getByText('02 Finance', { exact: true })).toBeVisible();
  // With AI off the files wait to be sorted, and say so.
  await expect(library.getByText('Not sorted').first()).toBeVisible();
});

test('a synthetic data room is read, re-read without duplicates, and the checklist asks for what is missing', async ({ page }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  await page.goto(`/deals/${dealId}/documents`);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByRole('button', { name: 'Sync now' }).click();

  const found = page.getByRole('list', { name: 'What the sync found' });
  await expect(found.getByText('04 Legal/BS 30-09-2026.md')).toBeVisible();
  await expect(found.getByText('Already here', { exact: true })).toHaveCount(1);
  await expect(found.getByText('New', { exact: true })).toHaveCount(9);
  await expect(page.getByText(/Last read .* — 9 new, 0 updated, 0 removed/)).toBeVisible();

  // Reading again finds nothing new.
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText(/Last read .* — 0 new, 0 updated, 0 removed/)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Documents' }).getByRole('link', { name: /BS 30-09-2026\.md/ })).toHaveCount(1);

  // Nothing is sorted with AI off, so every expected input is still missing and the request lists them.
  await expect(page.getByRole('heading', { name: /What this Software & SaaS pact needs/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy request for missing items' })).toBeVisible();
});
