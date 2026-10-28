'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { authApi, forgetPendingEmail, nativeSessionToken, pendingEmail, rememberPendingEmail, storeNativeSession, type IssuedSession } from '../../../lib/native-session';

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const here = (token: string, params: Record<string, string> = {}) => `/invite/${token}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;

/**
 * Accept the invitation as the signed-in user, then move the session onto the
 * pact (a guest session in the inviting organization) and open it. The API
 * checks the signed-in address matches the invitation.
 */
export async function acceptInvitation(token: string): Promise<void> {
  if (!tokenSchema.safeParse(token).success) redirect('/');
  const session = await nativeSessionToken();
  if (!session) redirect(`/login?${new URLSearchParams({ returnTo: here(token) })}`);
  const accepted = await authApi(`/v1/invitations/${token}/accept`, undefined, session);
  if (accepted.status !== 200) redirect(here(token, { error: 'not-accepted' }));
  const { organizationId, dealId } = accepted.data as { organizationId: string; dealId: string };
  const scoped = await authApi('/v1/auth/session/organization', { organizationId }, session);
  if (scoped.status !== 200) redirect(here(token, { error: 'switch' }));
  await storeNativeSession(scoped.data as IssuedSession);
  redirect(`/deals/${dealId}`);
}

const details = z.strictObject({ displayName: z.string().trim().min(1).max(120), organizationName: z.string().trim().min(2).max(120) });

/** New to Pactlab: create the invitee's own account and company with the invited address; no approval wait. */
export async function startInviteSignup(token: string, email: string, formData: FormData): Promise<void> {
  if (!tokenSchema.safeParse(token).success) redirect('/');
  const parsed = details.safeParse({ displayName: formData.get('displayName'), organizationName: formData.get('organizationName') });
  if (!parsed.success) redirect(here(token, { error: 'details' }));
  const started = await authApi('/v1/signup/start', { email, ...parsed.data, invitationToken: token });
  if (started.status !== 202) redirect(here(token, { error: 'unavailable' }));
  await rememberPendingEmail(email, 'invite');
  redirect(here(token, { step: 'code' }));
}

/** Confirm the sign-up code; then send a sign-in code so the invitee lands back here signed in. */
export async function confirmInviteSignup(token: string, formData: FormData): Promise<void> {
  if (!tokenSchema.safeParse(token).success) redirect('/');
  const email = await pendingEmail('invite');
  if (!email) redirect(here(token, { error: 'expired' }));
  const code = z.string().trim().regex(/^\d{6}$/).safeParse(formData.get('code'));
  if (!code.success) redirect(here(token, { step: 'code', error: 'code' }));
  const verified = await authApi('/v1/signup/verify', { email, code: code.data, invitationToken: token });
  if (verified.status !== 201) redirect(here(token, { step: 'code', error: 'code' }));
  await forgetPendingEmail('invite');
  const started = await authApi('/v1/auth/email/start', { email });
  if (started.status !== 202) redirect(`/login?${new URLSearchParams({ returnTo: here(token) })}`);
  await rememberPendingEmail(email, 'login');
  redirect(`/login?${new URLSearchParams({ returnTo: here(token), step: 'code', created: '1' })}`);
}
