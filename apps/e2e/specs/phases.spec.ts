import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';

// Pre-Diligence → Diligence → Post-Close (T-071): nothing is re-typed between phases.
test('screen a pact, say go, test its red flags as claims, then close it', async ({ page }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  await page.goto(`/deals/${dealId}`);
  await expect(page.getByText('Pre-Diligence', { exact: true }).first()).toBeVisible();

  // Pre-Diligence: light intake, screening-grade only.
  await page.getByRole('link', { name: 'Screening' }).click();
  await page.getByLabel('What the teaser or CIM says').fill('Teaser: vertical SaaS for dental clinics (synthetic).');
  await page.getByLabel('Headline revenue (last year)').fill('12,000,000');
  await page.getByLabel('Rough value — low').fill('40,000,000');
  await page.getByLabel('Rough value — high').fill('60,000,000');
  await page.getByLabel('Red flags (one per line)').fill('Top customer is 35% of revenue\nFounder runs all sales');
  await page.getByRole('button', { name: 'Save screening' }).click();
  await expect(page.getByText('Screening saved.')).toBeVisible();

  await page.getByRole('radio', { name: /Go — start diligence/ }).check();
  await page.getByLabel('Rationale').fill('Range brackets a sensible ask; worth diligence.');
  await page.getByRole('button', { name: 'Record verdict' }).click();

  // Diligence: the red flags arrive as claims to verify.
  await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/claims`));
  await expect(page.getByText('each red flag is now a claim to verify')).toBeVisible();
  const claims = page.getByRole('list', { name: 'Claims' });
  await expect(claims.getByText('Top customer is 35% of revenue')).toBeVisible();
  await expect(claims.getByText('Founder runs all sales')).toBeVisible();
  await expect(claims.getByText('From screening').first()).toBeVisible();

  const first = claims.getByRole('listitem').filter({ hasText: 'Top customer is 35% of revenue' });
  await first.getByText('Test against evidence').click();
  await first.getByLabel('Status').selectOption('CONTRADICTED');
  await first.getByLabel('What the evidence shows').fill('Billing shows the top customer at 41%.');
  await first.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Claim updated.')).toBeVisible();
  await expect(claims.getByRole('listitem').filter({ hasText: 'Top customer is 35% of revenue' }).getByText('Contradicted', { exact: true })).toBeVisible();

  // Post-Close: closing opens the registers.
  await page.goto(`/deals/${dealId}`);
  await expect(page.getByText('Diligence', { exact: true }).first()).toBeVisible();
  await page.getByRole('form', { name: 'Pipeline stage' }).getByRole('combobox').selectOption('CLOSED');
  await page.getByRole('button', { name: 'Move' }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/post-close`));
  await expect(page.getByRole('heading', { name: 'Assets to preserve' })).toBeVisible();
  await expect(page.getByText('Post-Close', { exact: true }).first()).toBeVisible();
});
