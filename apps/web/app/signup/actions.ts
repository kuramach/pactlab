'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { authApi, forgetPendingEmail, pendingEmail, rememberPendingEmail } from '../../lib/native-session';

const details = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  displayName: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().min(2).max(120),
  ssoRequested: z.boolean(),
});
const codeSchema = z.string().trim().regex(/^\d{6}$/);

const signupUrl = (params: Record<string, string>) => `/signup?${new URLSearchParams(params)}`;

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
  const started = await authApi('/v1/signup/start', parsed.data);
  if (started.status === 422) redirect(signupUrl({ error: 'work-email' }));
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
  const verified = await authApi('/v1/signup/verify', { email, code: code.data });
  if (verified.status !== 201) redirect(signupUrl({ step: 'code', error: 'code' }));
  await forgetPendingEmail('signup');
  const { status } = verified.data as { status: 'ACTIVE' | 'PENDING_APPROVAL' };
  redirect(signupUrl({ step: status === 'ACTIVE' ? 'ready' : 'pending' }));
}
