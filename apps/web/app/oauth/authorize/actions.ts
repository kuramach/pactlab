'use server';

import { redirect } from 'next/navigation';
import { authApi, nativeSessionToken } from '../../../lib/native-session';

/**
 * The person's decision on the consent page (T-084). The API checks everything again and
 * answers with where to send the browser: the client's redirect URI with a code, `state`
 * and `iss`, or with access_denied.
 */
export async function decide(params: Record<string, string>, approve: boolean): Promise<void> {
  const token = await nativeSessionToken();
  if (!token) redirect(`/login?${new URLSearchParams({ returnTo: `/oauth/authorize?${new URLSearchParams(params)}` })}`);
  const decided = await authApi('/v1/oauth/authorize', { params, approve }, token);
  // Connecting an AI assistant needs a sign-in under 8 hours old (T-112).
  if (decided.status === 422 && (decided.data as { code?: unknown } | null)?.code === 'RECENT_SIGN_IN_REQUIRED') {
    redirect(`/login?${new URLSearchParams({ reauth: '1', returnTo: `/oauth/authorize?${new URLSearchParams(params)}` })}`);
  }
  const next = (decided.data as { redirectTo?: unknown } | null)?.redirectTo;
  if (decided.status !== 200 || typeof next !== 'string') redirect(`/oauth/authorize?${new URLSearchParams({ ...params, failed: '1' })}`);
  redirect(next);
}
