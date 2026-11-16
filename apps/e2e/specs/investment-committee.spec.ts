import { expect, test } from '@playwright/test';
import { startPact } from '../support/deals';
import { REVIEWER, signIn } from '../support/login';

/** T-118: the deal lead submits a pact to the investment committee; a committee member decides it. */
test('submit a pact to the investment committee, and the committee approves it', { tag: '@smoke' }, async ({ page, browser }) => {
  // The organization's committee: the reviewer.
  await page.goto('/settings#investment-committee');
  // The committee is listed in full; anyone else is found through the searchable people list (T-126).
  const onCommittee = page.getByRole('list', { name: 'Committee members' }).getByRole('listitem').filter({ hasText: /reviewer/i }).getByRole('button', { name: 'Remove from committee' });
  if (!(await onCommittee.count())) {
    await page.getByLabel('Add someone').fill('reviewer');
    await page.getByRole('search').getByRole('button', { name: 'Search' }).click();
    await page.getByRole('list', { name: 'People in your organization' }).getByRole('listitem').filter({ hasText: /reviewer/i }).first().getByRole('button', { name: 'Add to committee' }).click();
  }
  await expect(onCommittee.first()).toBeVisible();

  const dealId = await startPact(page, 'Software & SaaS');
  await page.goto(`/deals/${dealId}/ic`);
  await page.getByRole('button', { name: 'Submit to the committee' }).click();
  await expect(page.getByText('Awaiting the committee').first()).toBeVisible();

  // The committee member, in their own browser.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const committee = await context.newPage();
  await signIn(committee, REVIEWER);
  await committee.goto(`/deals/${dealId}/ic`);
  const form = committee.getByRole('form', { name: 'Committee decision' });
  await form.getByLabel('Approved', { exact: true }).check();
  await form.getByLabel('Why').fill('Price and risks are within our mandate (synthetic e2e).');
  await form.getByRole('button', { name: 'Record the decision' }).click();
  await expect(committee.getByText('Decision recorded.')).toBeVisible();
  await context.close();

  await page.reload();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
});
