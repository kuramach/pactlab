'use server';

import { redirect } from 'next/navigation';
import { SIGN_IN_PATH } from '../../lib/auth-flow';
import { auth0 } from '../../lib/auth0';
import { authApi, clearNativeSession, nativeSessionToken } from '../../lib/native-session';

/**
 * Email-code sessions are revoked at the API (effective immediately) and the
 * cookie cleared; Auth0 sessions go through the SDK's logout route.
 */
export async function signOut(): Promise<void> {
  const token = await nativeSessionToken();
  if (!token) redirect(auth0() ? '/auth/logout' : SIGN_IN_PATH);
  try {
    await authApi('/v1/auth/logout', undefined, token);
  } finally {
    await clearNativeSession();
  }
  redirect(SIGN_IN_PATH);
}
