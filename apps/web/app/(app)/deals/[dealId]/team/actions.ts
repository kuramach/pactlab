'use server';

import { DEAL_ROLES } from '@pactlab/domain';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost, dealsApi } from '../../_lib/api';
import { UNSENT_INVITE_COOKIE } from './unsent-invite';
import { serverEnv } from '../../../../../lib/env';

const input = z.strictObject({ dealId: z.uuid(), userId: z.uuid(), role: z.enum(DEAL_ROLES) });

/** Add or change a member's role. Only deal leads may; the API decides. */
export async function addMember(dealId: string, formData: FormData): Promise<void> {
  const parsed = input.safeParse({ dealId, userId: formData.get('userId'), role: formData.get('role') });
  if (!parsed.success) redirect(`/deals/${dealId}/team?outcome=invalid`);
  const result = await dealsApi.addMember(parsed.data.dealId, parsed.data.userId, parsed.data.role);
  redirect(`/deals/${dealId}/team?outcome=${result.kind === 'ok' ? 'ok-added' : result.kind}`);
}

const invite = z.strictObject({
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  sideRole: z.enum(['BUYER:ANALYST', 'BUYER:REVIEWER', 'BUYER:VIEWER', 'SELLER:TARGET_CONTRIBUTOR', 'ADVISOR:ADVISER', 'ADVISOR:VIEWER']),
});

/** Invite someone by email to this pact, with a side and role (T-094 B12). Colleagues join directly; others get a link. */
export async function inviteByEmail(dealId: string, formData: FormData): Promise<void> {
  const parsed = invite.safeParse({ email: formData.get('email'), sideRole: formData.get('sideRole') });
  if (!z.uuid().safeParse(dealId).success) redirect('/deals');
  if (!parsed.success) redirect(`/deals/${dealId}/team?outcome=invalid-invite`);
  const [side, role] = parsed.data.sideRole.split(':');
  const result = await apiPost<{ kind: 'ADDED' | 'INVITED'; emailed?: boolean; emailProblem?: 'SUPPRESSED' | 'UNAVAILABLE'; link?: string }>(`/v1/deals/${dealId}/invitations`, { email: parsed.data.email, side, role });
  // The email did not go out (T-125): hand the link to the inviter once, in a short-lived cookie for this
  // page only, never in the address bar. It works only for the invited address.
  if (result.kind === 'ok' && result.data.kind === 'INVITED' && result.data.emailed === false && result.data.link) {
    (await cookies()).set(UNSENT_INVITE_COOKIE, JSON.stringify({ email: parsed.data.email, link: result.data.link, problem: result.data.emailProblem ?? 'UNAVAILABLE' }), {
      httpOnly: true,
      secure: serverEnv().APP_BASE_URL.startsWith('https://'),
      sameSite: 'strict',
      path: `/deals/${dealId}/team`,
      maxAge: 600,
    });
    redirect(`/deals/${dealId}/team?outcome=invite-not-emailed`);
  }
  const outcome = result.kind === 'ok' ? (result.data.kind === 'ADDED' ? 'ok-added' : 'ok-invited') : result.kind === 'conflict' ? 'already-invited' : 'code' in result && result.code ? `error-${result.code}` : result.kind;
  redirect(`/deals/${dealId}/team?outcome=${outcome}`);
}

/** Withdraw a pending invitation; its link stops working. */
export async function revokeInvitation(dealId: string, invitationId: string): Promise<void> {
  if (!z.uuid().safeParse(dealId).success || !z.uuid().safeParse(invitationId).success) redirect('/deals');
  const result = await apiPost(`/v1/deals/${dealId}/invitations/${invitationId}/revoke`, {});
  redirect(`/deals/${dealId}/team?outcome=${result.kind === 'ok' ? 'ok-revoked' : result.kind}`);
}
