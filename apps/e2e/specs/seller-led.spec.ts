import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { MAIL_DIR } from '../support/env';
import { LEAD } from '../support/login';
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

/** Start a seller-led pact through the wizard: no buying entity step. */
async function startSellerLed(page: Page): Promise<string> {
  const tag = randomUUID().slice(0, 8);
  await page.goto('/pacts/new');
  await page.getByRole('radio', { name: /We are selling/ }).check();
  await page.getByLabel('Pact name').fill(`E2E Sale ${tag}`);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Legal or trading name').fill(`E2E Seller ${tag} (synthetic)`);
  await page.getByRole('radio', { name: 'Private' }).check();
  await page.getByRole('radio', { name: /^Software & SaaS/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: 'Not known yet' }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText(/Bid process — you invite buyers once the pact starts/)).toBeVisible();
  await page.getByRole('button', { name: 'Start Pact' }).click();
  await expect(page).toHaveURL(/\/deals\/[0-9a-f-]{36}\/bidders$/);
  return /\/deals\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? '';
}

// T-097: the seller runs a bid process; a bidder joins from their own account, sees only their bid, asks, offers; the seller answers and awards.
test('a seller-led pact: invite a bidder, answer their question, compare and award', async ({ page, browser }) => {
  const dealId = await startSellerLed(page);
  await expect(page.getByRole('link', { name: 'Bidders' })).toBeVisible();

  await page.getByLabel(/Shared summary/).fill('Workflow software for logistics firms (synthetic). ARR 7.6m.');
  await page.getByLabel(/^NDA/).fill('Mutual NDA (synthetic): keep everything confidential.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Saved\. Bidders see the shared view/)).toBeVisible();

  await page.getByLabel('Bidding firm').fill('Harbor Capital (synthetic)');
  await page.getByRole('button', { name: 'Add bidder' }).click();
  await expect(page.getByText('Bidder added.')).toBeVisible();

  const bidder = `bidder-${Date.now()}@gmail.com`;
  const sent = Date.now() - 1_000;
  await page.getByLabel('Invite someone from Harbor Capital (synthetic)').fill(bidder);
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByText(/Invitation sent/)).toBeVisible();
  const link = new URL(await inviteLink(bidder, sent));

  // The bidder, in their own browser, with their own account.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const guest = await context.newPage();
  await guest.goto(link.pathname);
  await expect(guest.getByText(/as a bidder/)).toBeVisible();
  const signup = Date.now() - 1_000;
  await guest.getByLabel('Your name').fill('Blair Bidder');
  await guest.getByLabel('Your company').fill('Harbor Capital (synthetic)');
  await guest.getByRole('button', { name: `Create an account for ${bidder}` }).click();
  await guest.getByLabel('6-digit code').fill(await latestCode(bidder, signup));
  const signin = Date.now() - 1_000;
  await guest.getByRole('button', { name: 'Create my account' }).click();
  await expect(guest).toHaveURL(/\/login\?/);
  await guest.getByLabel('6-digit code').fill(await latestCode(bidder, signin));
  await guest.getByRole('button', { name: 'Sign in' }).click();
  await guest.getByRole('button', { name: 'Accept and open the pact' }).click();

  // Straight to their bid: the NDA first, nothing else.
  await expect(guest).toHaveURL(new RegExp(`/deals/${dealId}/bid$`));
  await expect(guest.getByText('Mutual NDA (synthetic)')).toBeVisible();
  await expect(guest.getByText(/Workflow software for logistics/)).toHaveCount(0);
  await expect(guest.getByRole('link', { name: 'Diligence' })).toHaveCount(0);
  await guest.getByRole('button', { name: 'I accept the NDA' }).click();
  await expect(guest.getByText(/Workflow software for logistics/)).toBeVisible();

  await guest.getByLabel('Question for the seller').fill('What is net revenue retention?');
  await guest.getByRole('button', { name: 'Ask' }).click();
  await expect(guest.getByText('Waiting for the seller’s answer.')).toBeVisible();

  await guest.getByLabel('Price').fill('52,000,000');
  await guest.getByLabel(/^Structure/).fill('Cash at close for 100% of shares');
  await guest.getByRole('button', { name: 'Submit offer' }).click();
  await expect(guest.getByText(/Offer submitted/)).toBeVisible();

  // The seller's side of the bid process is closed to the bidder.
  await guest.goto(`/deals/${dealId}/bidders`);
  await expect(guest.getByText('Workflow software for logistics firms (synthetic). ARR 7.6m.')).toHaveCount(0);

  // Seller: answer privately, see the offer, award.
  await page.goto(`/deals/${dealId}/bidders`);
  await page.getByLabel('Answer').fill('NRR is 112% (synthetic).');
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(page.getByText(/Answered privately/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Offers side by side' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'USD 52,000,000' })).toBeVisible();
  await page.getByRole('button', { name: 'Award to Harbor Capital (synthetic)' }).click();
  await expect(page.getByText(/^Awarded\./)).toBeVisible();

  await guest.goto(`/deals/${dealId}/bid`);
  await expect(guest.getByText('NRR is 112% (synthetic).')).toBeVisible();
  await expect(guest.getByText('Selected by the seller')).toBeVisible();

  // The winner's own diligence: a linked buyer-led pact in their own organization, with the seller's lead invited as the seller.
  const handover = Date.now() - 1_000;
  await guest.getByRole('button', { name: 'Start your diligence pact' }).click();
  await expect(guest).toHaveURL(/\/deals\/[0-9a-f-]{36}\/sources\?started=1&linked=1/);
  const linkedId = /\/deals\/([0-9a-f-]{36})\//.exec(guest.url())?.[1] ?? '';
  expect(linkedId).not.toBe(dealId);
  await expect(guest.getByText(/our diligence/).first()).toBeVisible();
  await expect(guest.getByText(/Harbor Capital \(synthetic\)/).first()).toBeVisible();
  await expect(guest.getByRole('link', { name: 'Diligence' })).toBeVisible();
  await inviteLink(LEAD, handover);
  await context.close();
});
