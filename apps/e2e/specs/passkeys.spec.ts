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
    // The one-time offer appears right after an email sign-in.
    await expect(page.getByRole('complementary', { name: 'Add a passkey' })).toBeVisible();

    await page.goto('/settings#sign-in');
    const card = page.locator('#sign-in');
    await card.getByLabel('Name').fill('E2E laptop');
    await card.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(card.getByRole('list', { name: 'Your passkeys' })).toContainText('E2E laptop');
    // Added: the offer is gone.
    await expect(page.getByRole('complementary', { name: 'Add a passkey' })).toHaveCount(0);

    await page.getByRole('main').getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page).not.toHaveURL(/\/login/);

    await page.goto('/settings#sign-in');
    await expect(card).toContainText('last used');
    await card.getByRole('button', { name: 'Remove E2E laptop' }).click();
    await expect(card).toContainText('No passkeys yet.');
  });
});
