import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { MAIL_DIR } from '../support/env';
import { latestCode } from '../support/mail';

/** The newest link of a kind emailed to an address. */
async function linkIn(address: string, after: number, pattern: RegExp): Promise<string> {
  let link = '';
  await expect
    .poll(() => {
      for (const name of readdirSync(MAIL_DIR).filter((file) => file.endsWith('.txt'))) {
        const path = join(MAIL_DIR, name);
        if (statSync(path).mtimeMs < after) continue;
        const text = readFileSync(path, 'utf8');
        if (/^To: (.+)$/m.exec(text)?.[1]?.trim().toLowerCase() !== address) continue;
        link = pattern.exec(text)?.[1] ?? '';
        if (link) return true;
      }
      return false;
    }, { message: `a link for ${address}`, timeout: 15_000 })
    .toBe(true);
  return link;
}

async function startSellerLed(page: Page, tag: string): Promise<string> {
  await page.goto('/pacts/new');
  await page.getByRole('radio', { name: /We are selling/ }).check();
  await page.getByLabel('Pact name').fill(`E2E Listing ${tag}`);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Legal or trading name').fill(`Secret Seller ${tag} (synthetic)`);
  await page.getByRole('radio', { name: 'Private' }).check();
  await page.getByRole('radio', { name: /^Software & SaaS/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: 'Not known yet' }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Start Pact' }).click();
  await expect(page).toHaveURL(/\/deals\/[0-9a-f-]{36}\/bidders$/);
  return /\/deals\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? '';
}

// A seller markets a pact on a public page; a visitor requests access, confirms by email, is approved, joins as a bidder and signs the NDA.
test('public deal page: publish, request access, confirm, approve, join', async ({ page, browser }) => {
  const tag = randomUUID().slice(0, 8);
  const dealId = await startSellerLed(page, tag);
  await page.getByLabel(/Shared summary/).fill('Workflow software for logistics firms (synthetic). ARR 7.6m.');
  await page.getByLabel(/^NDA/).fill('Mutual NDA (synthetic).');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Public page' }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/listing$`));
  await page.getByLabel(/^Codename/).fill(`Project Atlas ${tag}`);
  await page.getByLabel(/^Headline/).fill('Profitable workflow SaaS for logistics firms');
  await page.getByLabel(/^Sector/).fill('Software & SaaS');
  await page.getByLabel(/^Highlights/).fill('Founder-led\nNet revenue retention above 110%');
  await page.getByRole('button', { name: 'Create the page' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published\. Anyone with the link/)).toBeVisible();
  const link = new URL((await page.getByText(/\/listings\/pl-[a-z0-9]{10}/).textContent()) ?? '');

  // A signed-out visitor.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await context.newPage();
  await visitor.goto(link.pathname);
  await expect(visitor.getByRole('heading', { name: `Project Atlas ${tag}` })).toBeVisible();
  await expect(visitor.getByText('Founder-led')).toBeVisible();
  await expect(visitor.getByText(`Secret Seller ${tag}`)).toHaveCount(0);
  await expect(visitor.getByText(/Workflow software for logistics/)).toHaveCount(0);

  const buyer = `buyer-${Date.now()}@gmail.com`;
  const asked = Date.now() - 1_000;
  await visitor.getByLabel('Your name').fill('Blair Buyer');
  await visitor.getByLabel('Firm', { exact: true }).fill(`Harbor Capital ${tag} (synthetic)`);
  await visitor.getByLabel('Work email').fill(buyer);
  await visitor.getByLabel('You are').selectOption('FINANCIAL');
  await visitor.getByLabel(/^Message to the seller/).fill('We buy workflow SaaS.');
  await visitor.getByRole('checkbox', { name: /I agree that the seller sees/ }).check();
  await visitor.getByRole('button', { name: 'Send request' }).click();
  await expect(visitor.getByText('Check your email')).toBeVisible();

  // Not with the seller until confirmed.
  await page.reload();
  await expect(page.getByText(/No requests yet/)).toBeVisible();
  const confirm = new URL(await linkIn(buyer, asked, /(https?:\/\/\S+\/listings\/confirm\/[A-Za-z0-9_-]{43})/));
  await visitor.goto(confirm.pathname);
  await visitor.getByRole('button', { name: 'Confirm my request' }).click();
  await expect(visitor.getByText('Request sent to the seller')).toBeVisible();

  // The seller approves: the firm becomes a bidder and the buyer is invited, under the codename.
  await page.reload();
  const request = page.getByRole('list', { name: 'Access requests' }).getByRole('listitem').filter({ hasText: buyer });
  await expect(request.getByText('We buy workflow SaaS.')).toBeVisible();
  const approved = Date.now() - 1_000;
  await request.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/Approved\. Their firm is now a bidder/)).toBeVisible();
  const invite = new URL(await linkIn(buyer, approved, /(https?:\/\/\S+\/invite\/[A-Za-z0-9_-]{43})/));
  await page.goto(`/deals/${dealId}/bidders`);
  await expect(page.getByText(`Harbor Capital ${tag} (synthetic)`).first()).toBeVisible();

  // The buyer creates an account from the invitation, signs the NDA and sees the shared view.
  await visitor.goto(invite.pathname);
  const signup = Date.now() - 1_000;
  await visitor.getByLabel('Your name').fill('Blair Buyer');
  await visitor.getByLabel('Your company').fill(`Harbor Capital ${tag} (synthetic)`);
  await visitor.getByRole('button', { name: `Create an account for ${buyer}` }).click();
  await visitor.getByLabel('6-digit code').fill(await latestCode(buyer, signup));
  const signin = Date.now() - 1_000;
  await visitor.getByRole('button', { name: 'Create my account' }).click();
  await expect(visitor).toHaveURL(/\/login\?/);
  await visitor.getByLabel('6-digit code').fill(await latestCode(buyer, signin));
  await visitor.getByRole('button', { name: 'Sign in' }).click();
  await visitor.getByRole('button', { name: 'Accept and open the pact' }).click();
  await expect(visitor).toHaveURL(new RegExp(`/deals/${dealId}/bid$`));
  await expect(visitor.getByText(/Workflow software for logistics/)).toHaveCount(0);
  await visitor.getByRole('button', { name: 'I accept the NDA' }).click();
  await expect(visitor.getByText(/Workflow software for logistics/)).toBeVisible();
  await context.close();
});
