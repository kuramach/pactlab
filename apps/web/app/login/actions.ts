'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeReturnTo, SELECT_ORGANIZATION_PATH, SIGN_IN_PATH } from '../../lib/auth-flow';
import {
  authApi,
  forgetPendingEmail,
  pendingEmail,
  rememberPendingEmail,
  storeNativeSession,
  type IssuedSession,
} from '../../lib/native-session';

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const codeSchema = z.string().trim().regex(/^\d{6}$/);

const loginUrl = (params: Record<string, string>) => `${SIGN_IN_PATH}?${new URLSearchParams(params)}`;

/**
 * Ask the API to email a code. The API answers identically whether or not
 * the address can sign in this way, so the next screen never reveals it.
 */
export async function requestCode(formData: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData.get('returnTo'));
  const email = emailSchema.safeParse(formData.get('email'));
  if (!email.success) redirect(loginUrl({ returnTo, error: 'email' }));
  const started = await authApi('/v1/auth/email/start', { email: email.data });
  if (started.status !== 202) redirect(loginUrl({ returnTo, error: 'unavailable' }));
  await rememberPendingEmail(email.data);
  redirect(loginUrl({ returnTo, step: 'code' }));
}

/** Exchange the code for a session cookie, then enter the app (or pick an organization). */
export async function submitCode(formData: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData.get('returnTo'));
  const email = await pendingEmail();
  if (!email) redirect(loginUrl({ returnTo, error: 'expired' }));
  const code = codeSchema.safeParse(formData.get('code'));
  if (!code.success) redirect(loginUrl({ returnTo, step: 'code', error: 'code' }));
  const verified = await authApi('/v1/auth/email/verify', { email, code: code.data });
  if (verified.status !== 200) redirect(loginUrl({ returnTo, step: 'code', error: 'code' }));
  const session = verified.data as IssuedSession;
  await storeNativeSession(session);
  await forgetPendingEmail();
  redirect(
    session.organizationId
      ? returnTo
      : `${SELECT_ORGANIZATION_PATH}?${new URLSearchParams({ returnTo })}`,
  );
}
