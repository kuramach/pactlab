import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';
import { uploadDocument } from '../support/documents';
import { AI_LOG } from '../support/env';

/** AI requests the API made so far this run, all answered by the fixture provider (T-113). */
const aiRequests = () => {
  try {
    return readFileSync(AI_LOG, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { provider: string; live: boolean });
  } catch {
    return [];
  }
};

test('a data-room document uploads, opens by page, and AI extraction runs on the fixture provider', { tag: '@smoke' }, async ({ page }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  await uploadDocument(page, dealId, 'customer-contract.txt', 'Master subscription agreement (synthetic).\n\nThe customer may terminate for convenience on 30 days notice.');

  await page.getByRole('navigation', { name: 'Documents' }).getByRole('link', { name: /customer-contract\.txt/ }).click();
  await expect(page.getByRole('navigation', { name: 'Pages' }).first().getByText('Page 1 of 1')).toBeVisible();
  await expect(page.getByText('may terminate for convenience')).toBeVisible();

  // Outcome, not prose: the run reached the model seam (the fixture), and no failure or "AI off" shows.
  const before = aiRequests().length;
  await page.getByRole('button', { name: 'Re-run AI extraction' }).click();
  await expect.poll(() => aiRequests().length).toBeGreaterThan(before);
  expect(aiRequests().every((request) => request.provider === 'fixture' && request.live === false)).toBe(true);
  await expect(page.getByText(/AI is not switched on/)).toHaveCount(0);
  await expect(page.getByText('The model call failed or timed out')).toHaveCount(0);
});
