import { expect, test } from '@playwright/test';
import { REVIEWER, signIn } from '../support/login';

/**
 * T-108: add a passkey after an email sign-in, sign out, sign back in with it (no code),
 * then remove it. Chromium's virtual authenticator stands in for Touch ID: it holds the
 * key and answers user verification, exactly where a real device would.
 */
test.describe('passkey sign-in', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('add a passkey, sign in with it, remove it', async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });

    await signIn(page, REVIEWER);
    await page.goto('/settings#sign-in');
    const card = page.locator('#sign-in');
    // Independent of earlier runs (and retries): start with no passkeys.
    const removeButtons = card.getByRole('button', { name: /^Remove / });
    for (let left = await removeButtons.count(); left > 0; left -= 1) {
      await removeButtons.first().click();
      await expect(removeButtons).toHaveCount(left - 1);
    }
    await expect(card).toContainText('No passkeys yet.');
    // The one-time offer shows right after an email sign-in, while there is no passkey.
    await expect(page.getByRole('complementary', { name: 'Add a passkey' })).toBeVisible();
    await card.getByLabel('Name').fill('E2E laptop');
    await card.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(card.getByRole('list', { name: 'Your passkeys' })).toContainText('E2E laptop');
    // Added: the offer is gone.
    await expect(page.getByRole('complementary', { name: 'Add a passkey' })).toHaveCount(0);

    await page.getByRole('main').getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    // The browser offers the saved passkey on the email field (autofill) and may sign in on its
    // own; otherwise the button does. Either way, no email code.
    const button = page.getByRole('button', { name: 'Sign in with a passkey' });
    await expect(button).toBeVisible();
    if (await button.isEnabled()) await button.click({ timeout: 5_000 }).catch(() => undefined);
    await expect(page).not.toHaveURL(/\/login/);

    await page.goto('/settings#sign-in');
    await expect(card).toContainText('last used');
    await card.getByRole('button', { name: 'Remove E2E laptop' }).click();
    await expect(card).toContainText('No passkeys yet.');
  });
});
