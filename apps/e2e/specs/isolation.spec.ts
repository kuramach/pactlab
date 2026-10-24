import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { AUTH_DIR, REPO, serverEnv } from '../support/env';
import { signIn } from '../support/login';
import { latestCode } from '../support/mail';

// Charlie Advisory's seeded deal (packages/db/src/seed/synthetic.ts).
const CHARLIE_DEAL = { id: '01900000-0000-7000-8000-00000000c003', name: 'Project Beacon' };

test.use({ storageState: { cookies: [], origins: [] } });

test('a second organization cannot open another tenant’s deal', async ({ page, browser }) => {
  // Control: Charlie's own lead sees the deal at this URL.
  const lead = await browser.newContext({ storageState: `${AUTH_DIR}/lead.json` });
  const leadPage = await lead.newPage();
  await leadPage.goto(`/deals/${CHARLIE_DEAL.id}`);
  await expect(leadPage.getByRole('heading', { name: CHARLIE_DEAL.name })).toBeVisible();
  await lead.close();

  const tag = randomUUID().slice(0, 8);
  const email = `owner@isolation-${tag}.example`;

  // Sign up a new organization, then approve it the way the operator does.
  const requested = Date.now() - 1_000;
  await page.goto('/signup');
  await page.getByLabel('Organization name').fill(`Isolation ${tag} (synthetic)`);
  await page.getByLabel('Your name').fill('Isolation Owner (synthetic)');
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('6-digit code').fill(await latestCode(email, requested));
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/step=(pending|ready)/);

  const pending = spawnSync('pnpm', ['--silent', 'org:pending'], { cwd: REPO, env: serverEnv(), encoding: 'utf8' });
  const slug = pending.stdout.split('\n').find((line) => line.includes(email))?.split(/\s+/)[0];
  expect(slug, pending.stderr).toBeTruthy();
  const approved = spawnSync('pnpm', ['--silent', 'org:approve', slug ?? ''], { cwd: REPO, env: serverEnv(), encoding: 'utf8' });
  expect(approved.status, approved.stderr).toBe(0);

  await signIn(page, email);
  for (const path of ['', '/sources', '/findings', '/valuation']) {
    await page.goto(`/deals/${CHARLIE_DEAL.id}${path}`);
    await expect(page.getByText('This item does not exist or you do not have access to it.').first()).toBeVisible();
    await expect(page.getByText(CHARLIE_DEAL.name)).toHaveCount(0);
  }
  await page.goto('/deals');
  await expect(page.getByRole('heading', { name: 'My deals' })).toBeVisible();
  await expect(page.getByText(CHARLIE_DEAL.name)).toHaveCount(0);
});
