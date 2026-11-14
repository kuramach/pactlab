'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeReturnTo, SELECT_ORGANIZATION_PATH, SIGN_IN_PATH } from '../../lib/auth-flow';
import { trustChoice } from '../../lib/device-label';
import {
  authApi,
  forgetPendingEmail,
  forgetPendingTrust,
  nativeSessionToken,
  pendingEmail,
  pendingTrust,
  rememberPasskeyOffer,
  rememberPendingEmail,
  rememberPendingTrust,
  retireSession,
  storeNativeSession,
  trustFields,
  type IssuedSession,
} from '../../lib/native-session';

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const codeSchema = z.string().trim().regex(/^\d{6}$/);

/** An organization's own sign-in page (T-123) stays its page through both steps. */
const brandSlug = (formData: FormData) => {
  const slug = formData.get('brand');
  return typeof slug === 'string' && /^[a-z0-9-]{2,80}$/.test(slug) ? slug : null;
};
const loginUrl = (formData: FormData, params: Record<string, string>) => {
  const slug = brandSlug(formData);
  return `${slug ? `${SIGN_IN_PATH}/${slug}` : SIGN_IN_PATH}?${new URLSearchParams(params)}`;
};
/** A step-up sign-in (T-112) stays one through both steps. */
const reauthOf = (formData: FormData): Record<string, string> => (formData.get('reauth') === '1' ? { reauth: '1' } : {});

/**
 * Ask the API to email a code. The API answers identically whether or not
 * the address can sign in this way, so the next screen never reveals it.
 */
export async function requestCode(formData: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData.get('returnTo'));
  const email = emailSchema.safeParse(formData.get('email'));
  if (!email.success) redirect(loginUrl(formData, { returnTo, ...reauthOf(formData), error: 'email' }));
  const started = await authApi('/v1/auth/email/start', { email: email.data });
  if (started.status !== 202) redirect(loginUrl(formData, { returnTo, ...reauthOf(formData), error: 'unavailable' }));
  await rememberPendingEmail(email.data);
  await rememberPendingTrust(trustChoice(formData.get('trust')));
  redirect(loginUrl(formData, { returnTo, ...reauthOf(formData), step: 'code' }));
}

/** Exchange the code for a session cookie, then enter the app (or pick an organization). */
export async function submitCode(formData: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData.get('returnTo'));
  const email = await pendingEmail();
  if (!email) redirect(loginUrl(formData, { returnTo, ...reauthOf(formData), error: 'expired' }));
  const code = codeSchema.safeParse(formData.get('code'));
  if (!code.success) redirect(loginUrl(formData, { returnTo, ...reauthOf(formData), step: 'code', error: 'code' }));
  const verified = await authApi('/v1/auth/email/verify', { email, code: code.data, ...(await trustFields(trustChoice(await pendingTrust()))) });
  if (verified.status !== 200) redirect(loginUrl(formData, { returnTo, ...reauthOf(formData), step: 'code', error: 'code' }));
  const session = verified.data as IssuedSession;
  const previous = await nativeSessionToken();
  await storeNativeSession(session);
  await retireSession(previous);
  await forgetPendingEmail();
  await forgetPendingTrust();
  // The one-time "add a passkey" offer, while this sign-in is fresh enough to add one (T-108).
  await rememberPasskeyOffer();
  redirect(
    session.organizationId
      ? returnTo
      : `${SELECT_ORGANIZATION_PATH}?${new URLSearchParams({ returnTo })}`,
  );
}
