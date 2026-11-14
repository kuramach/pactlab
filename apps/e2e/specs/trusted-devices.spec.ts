import { expect, test } from '@playwright/test';
import { REVIEWER, signIn } from '../support/login';

/** T-112: trust a device for a week, see it in Settings, sign out the others, then this one. */
test.describe('trusted devices', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a trusted sign-in is listed and can be signed out, elsewhere and here', { tag: '@regression' }, async ({ page, browser }) => {
    // Another device: a second browser signed in the usual way.
    const elsewhere = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const other = await elsewhere.newPage();
    await signIn(other, REVIEWER);

    await signIn(page, REVIEWER, 'Yes, for 1 week');
    await page.goto('/settings#devices');
    const devices = page.getByRole('list', { name: 'Signed-in devices' });
    const here = devices.getByRole('listitem').filter({ hasText: 'This device' });
    await expect(here).toContainText('Trusted');
    await expect(devices.getByRole('listitem')).not.toHaveCount(1);

    await page.getByRole('button', { name: 'End all other sessions' }).click();
    await expect(devices.getByRole('listitem')).toHaveCount(1);
    await other.goto('/settings');
    await expect(other).toHaveURL(/\/login/);
    await elsewhere.close();

    await here.getByRole('button', { name: /^End session on .*\(this device\)$/ }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/);
  });
});
