import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { DEMO_DIR } from './env';

/** The seller types the specs use, by their wizard label. */
export type Seller = 'Software & SaaS' | 'Fintech' | 'Multifamily';

/**
 * Start a fresh Pact through the real five-step wizard, so every spec owns
 * its deal. Returns the new deal's id.
 */
export async function startPact(page: Page, seller: Seller, currency = 'USD'): Promise<string> {
  const tag = randomUUID().slice(0, 8);
  await page.goto('/pacts/new');
  await page.getByLabel('Pact name').fill(`E2E ${seller} ${tag}`);
  await page.getByLabel('Base currency').selectOption(currency);
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByLabel('Legal or trading name').fill(`E2E Buyer ${tag} (synthetic)`);
  await page.getByRole('radio', { name: 'Private' }).check();
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByLabel('Legal or trading name').fill(`E2E Seller ${tag} (synthetic)`);
  await page.getByRole('radio', { name: 'Private' }).check();
  await page.getByRole('radio', { name: new RegExp(`^${seller.replace(/[&]/g, '\\$&')}`) }).check();
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByRole('radio', { name: 'Not known yet' }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Check the details. The deal type is fixed when the Pact starts.')).toBeVisible();
  await page.getByRole('button', { name: 'Start Pact' }).click();

  await expect(page).toHaveURL(/\/deals\/[0-9a-f-]{36}\/sources\?started=1/);
  return /\/deals\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? '';
}

/** A file from the synthetic demo data set (scripts/demo-data), generated per run. */
export const demoFile = (pack: string, currency: string, file: string) => join(DEMO_DIR, pack, currency, file);
