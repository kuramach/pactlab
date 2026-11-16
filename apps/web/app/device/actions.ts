'use server';

import { redirect } from 'next/navigation';
import { authApi, nativeSessionToken } from '../../lib/native-session';

/**
 * The person's decision on a script's sign-in code (T-128, RFC 8628). The API checks the code,
 * the organization and the API switch again; the script then picks up its tokens by polling.
 */
export async function decideDevice(userCode: string, approve: boolean): Promise<void> {
  const here = `/device?${new URLSearchParams({ code: userCode })}`;
  const token = await nativeSessionToken();
  if (!token) redirect(`/login?${new URLSearchParams({ returnTo: here })}`);
  const decided = await authApi('/v1/oauth/device/decide', { userCode, approve }, token);
  // Signing in a script needs a sign-in under 8 hours old, like connecting an app (T-112).
  if (decided.status === 422 && (decided.data as { code?: unknown } | null)?.code === 'RECENT_SIGN_IN_REQUIRED') {
    redirect(`/login?${new URLSearchParams({ reauth: '1', returnTo: here })}`);
  }
  if (decided.status !== 200) redirect(`${here}&failed=1`);
  redirect(`/device?done=${approve ? 'approved' : 'declined'}`);
}
