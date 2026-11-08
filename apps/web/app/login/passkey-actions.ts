'use server';

import type { PasskeyOptionsView } from '@pactlab/contracts';
import { safeReturnTo, SELECT_ORGANIZATION_PATH } from '../../lib/auth-flow';
import { authApi, storeNativeSession, type IssuedSession } from '../../lib/native-session';

/**
 * Passkey sign-in (T-108). The browser runs the WebAuthn ceremony; these actions
 * fetch the options and hand the answer to the API, so the session token is only
 * ever set as an httpOnly cookie, as after an email code.
 */
export async function passkeySignInOptions(): Promise<PasskeyOptionsView | null> {
  const started = await authApi('/v1/auth/passkey/options', {});
  return started.status === 200 ? (started.data as PasskeyOptionsView) : null;
}

/** Where to go next, or null when the passkey was not accepted (one message for every failure). */
export async function completePasskeySignIn(challengeId: string, response: unknown, returnToInput: string): Promise<string | null> {
  const returnTo = safeReturnTo(returnToInput);
  const verified = await authApi('/v1/auth/passkey/verify', { challengeId, response });
  if (verified.status !== 200) return null;
  const session = verified.data as IssuedSession;
  await storeNativeSession(session);
  return session.organizationId ? returnTo : `${SELECT_ORGANIZATION_PATH}?${new URLSearchParams({ returnTo })}`;
}
