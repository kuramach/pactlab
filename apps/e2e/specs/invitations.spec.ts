import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';
import { MAIL_DIR } from '../support/env';
import { latestCode } from '../support/mail';

/** The newest invitation link emailed to an address. */
async function inviteLink(address: string, after: number): Promise<string> {
  let link = '';
  await expect
    .poll(() => {
      for (const name of readdirSync(MAIL_DIR).filter((file) => file.endsWith('.txt'))) {
        const path = join(MAIL_DIR, name);
        if (statSync(path).mtimeMs < after) continue;
        const text = readFileSync(path, 'utf8');
        if (/^To: (.+)$/m.exec(text)?.[1]?.trim().toLowerCase() !== address) continue;
        link = /(https?:\/\/\S+\/invite\/[A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? '';
        if (link) return true;
      }
      return false;
    }, { message: `an invitation for ${address}`, timeout: 15_000 })
    .toBe(true);
  return link;
}

// T-094 B12: the lead invites a seller by email; the seller creates their own account, accepts, and sees only that pact.
test('a seller invited by email joins one pact as a guest, from their own account', async ({ page, browser }) => {
  const dealId = await startPact(page, 'Software & SaaS');
  const seller = `seller-${Date.now()}@gmail.com`;
  await page.goto(`/deals/${dealId}/team`);
  const sent = Date.now() - 1_000;
  await page.getByLabel('Email').fill(seller);
  await page.getByLabel('Side and role').selectOption('SELLER:TARGET_CONTRIBUTOR');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Invitation sent.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Invitations' }).getByText(seller)).toBeVisible();
  const link = new URL(await inviteLink(seller, sent));

  // The seller, signed out, in their own browser.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const guest = await context.newPage();
  await guest.goto(link.pathname);
  await expect(guest.getByText(/You join this pact only/)).toBeVisible();
  const signup = Date.now() - 1_000;
  await guest.getByLabel('Your name').fill('Sam Seller');
  await guest.getByLabel('Your company').fill('Loopwise (synthetic)');
  await guest.getByRole('button', { name: `Create an account for ${seller}` }).click();
  await guest.getByLabel('6-digit code').fill(await latestCode(seller, signup));
  const signin = Date.now() - 1_000;
  await guest.getByRole('button', { name: 'Create my account' }).click();
  // A sign-in code follows, and the invitation page comes back signed in.
  await expect(guest).toHaveURL(/\/login\?/);
  await guest.getByLabel('6-digit code').fill(await latestCode(seller, signin));
  await guest.getByRole('button', { name: 'Sign in' }).click();
  await guest.getByRole('button', { name: 'Accept and open the pact' }).click();
  await expect(guest).toHaveURL(new RegExp(`/deals/${dealId}$`));
  await expect(guest.getByText('(guest)').first()).toBeVisible();

  // Seller side: no buyer-only valuation, and no other deals of the inviting organization.
  await guest.goto(`/deals/${dealId}/valuation`);
  await expect(guest.getByText('No access')).toBeVisible();
  await expect(guest.getByRole('link', { name: 'Start a Pact' })).toHaveCount(0);
  await expect(guest.getByRole('link', { name: 'Comparables' })).toHaveCount(0);
  await guest.goto('/deals');
  // Exactly one pact listed: the one they were invited to.
  await expect(guest.getByRole('row').filter({ hasText: /E2E Software & SaaS/ })).toHaveCount(1);
  await expect(guest.getByRole('link', { name: 'Start a Pact' })).toHaveCount(0);
  await context.close();

  // The lead sees the seller on the team, on the seller side.
  await page.goto(`/deals/${dealId}/team`);
  await expect(page.getByText('Sam Seller')).toBeVisible();
  await expect(page.getByText('Seller side').first()).toBeVisible();
});
