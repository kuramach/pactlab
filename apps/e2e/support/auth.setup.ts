import { test as setup } from '@playwright/test';
import { AUTH_DIR } from './env';
import { LEAD, signIn } from './login';

/** Sign in once as Charlie's deal lead; specs start from this session. */
setup('sign in as the deal lead', async ({ page }) => {
  await signIn(page, LEAD);
  await page.context().storageState({ path: `${AUTH_DIR}/lead.json` });
});
