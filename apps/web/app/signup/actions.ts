'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { authApi, forgetPendingEmail, pendingEmail, rememberPendingEmail, storeNativeSession, type IssuedSession } from '../../lib/native-session';

const details = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  displayName: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().min(2).max(120),
  ssoRequested: z.boolean(),
});
const codeSchema = z.string().trim().regex(/^\d{6}$/);

const signupUrl = (params: Record<string, string>) => `/signup?${new URLSearchParams(params)}`;
const promoSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,40}$/);
// The promo code waits beside the pending email until the code is confirmed (T-087).
const PROMO_COOKIE = { name: 'pactlab_signup_promo', path: '/signup' } as const;

/**
 * Ask the API to email a sign-up code. The API answers the same for new and
 * existing addresses; only a non-work address is refused up front.
 */
export async function startSignup(formData: FormData): Promise<void> {
  const parsed = details.safeParse({
    email: formData.get('email'),
    displayName: formData.get('displayName'),
    organizationName: formData.get('organizationName'),
    ssoRequested: formData.get('ssoRequested') === 'on',
  });
  if (!parsed.success) redirect(signupUrl({ error: 'details' }));
  // A promo code is checked before anything is sent, so a typo is caught now.
  const rawPromo = String(formData.get('promoCode') ?? '').trim();
  const promo = rawPromo ? promoSchema.safeParse(rawPromo) : null;
  if (promo && !promo.success) redirect(signupUrl({ error: 'promo-UNKNOWN' }));
  if (promo?.success) {
    const checked = await authApi('/v1/billing/promo/check', { code: promo.data });
    const result = checked.data as { valid?: boolean; reason?: string } | null;
    if (checked.status !== 200 || !result?.valid) redirect(signupUrl({ error: `promo-${result?.reason ?? 'UNKNOWN'}` }));
  }
  const store = await cookies();
  if (promo?.success) store.set(PROMO_COOKIE.name, promo.data, { httpOnly: true, sameSite: 'lax', path: PROMO_COOKIE.path, maxAge: 15 * 60 });
  else store.delete({ name: PROMO_COOKIE.name, path: PROMO_COOKIE.path });
  const started = await authApi('/v1/signup/start', parsed.data);
  if (started.status === 422) redirect(signupUrl({ error: 'sso-work-email' }));
  if (started.status !== 202) redirect(signupUrl({ error: 'unavailable' }));
  await rememberPendingEmail(parsed.data.email, 'signup');
  redirect(signupUrl({ step: 'code' }));
}

/** Confirm the code; the organization and its owner are created now. */
export async function confirmSignup(formData: FormData): Promise<void> {
  const email = await pendingEmail('signup');
  if (!email) redirect(signupUrl({ error: 'expired' }));
  const code = codeSchema.safeParse(formData.get('code'));
  if (!code.success) redirect(signupUrl({ step: 'code', error: 'code' }));
  const store = await cookies();
  const promoCode = store.get(PROMO_COOKIE.name)?.value;
  const verified = await authApi('/v1/signup/verify', { email, code: code.data, ...(promoCode ? { promoCode } : {}) });
  const problem = (verified.data as { code?: string } | null)?.code;
  if (verified.status === 422 && problem?.startsWith('PROMO_')) {
    store.delete({ name: PROMO_COOKIE.name, path: PROMO_COOKIE.path });
    redirect(signupUrl({ error: `promo-${problem.slice('PROMO_'.length)}` }));
  }
  if (verified.status !== 201) redirect(signupUrl({ step: 'code', error: 'code' }));
  await forgetPendingEmail('signup');
  store.delete({ name: PROMO_COOKIE.name, path: PROMO_COOKIE.path });
  const { status, session } = verified.data as { status: 'ACTIVE' | 'PENDING_APPROVAL'; session?: IssuedSession };
  // An active organization is signed in at once (batch 1): straight to the app, no second code.
  if (session) {
    await storeNativeSession(session);
    redirect('/');
  }
  redirect(signupUrl({ step: status === 'ACTIVE' ? 'ready' : 'pending' }));
}
