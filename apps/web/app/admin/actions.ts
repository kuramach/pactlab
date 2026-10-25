'use server';

import { decideOrganizationSchema, memberStatusSchema, organizationFlagsSchema, organizationStatusSchema, triageBugSchema } from '@pactlab/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost, apiSend } from '../(app)/deals/_lib/api';

const uuid = z.uuid();
const back = (tab: string, outcome: string): never => redirect(`/admin?tab=${tab}&outcome=${outcome}`);

export async function decideOrganization(slug: string, formData: FormData): Promise<void> {
  const parsed = decideOrganizationSchema.safeParse({ decision: formData.get('decision') });
  if (!parsed.success || !/^[a-z0-9-]{2,80}$/.test(slug)) return back('approvals', 'invalid');
  const result = await apiPost(`/v1/admin/approvals/${slug}`, parsed.data);
  revalidatePath('/admin');
  back('approvals', result.kind === 'ok' ? `ok-${parsed.data.decision}` : result.kind);
}

export async function setOrganizationStatus(organizationId: string, formData: FormData): Promise<void> {
  const parsed = organizationStatusSchema.safeParse({ status: formData.get('status') });
  if (!parsed.success || !uuid.safeParse(organizationId).success) return back('organizations', 'invalid');
  const result = await apiSend('PUT', `/v1/admin/organizations/${organizationId}/status`, parsed.data);
  back('organizations', result.kind === 'ok' ? 'ok-status' : result.kind);
}

export async function setOrganizationFlags(organizationId: string, formData: FormData): Promise<void> {
  const parsed = organizationFlagsSchema.safeParse({ pilotMode: formData.get('pilotMode') === 'on', liveConnectors: formData.get('liveConnectors') === 'on' });
  if (!parsed.success || !uuid.safeParse(organizationId).success) return back('organizations', 'invalid');
  const result = await apiSend('PUT', `/v1/admin/organizations/${organizationId}/flags`, parsed.data);
  back('organizations', result.kind === 'ok' ? 'ok-flags' : result.kind);
}

export async function setMemberStatus(organizationId: string, userId: string, formData: FormData): Promise<void> {
  const parsed = memberStatusSchema.safeParse({ status: formData.get('status') });
  if (!parsed.success || !uuid.safeParse(organizationId).success || !uuid.safeParse(userId).success) return back('users', 'invalid');
  const result = await apiSend('PUT', `/v1/admin/organizations/${organizationId}/members/${userId}/status`, parsed.data);
  back('users', result.kind === 'ok' ? 'ok-member' : result.kind);
}

export async function triageBug(bugId: string, formData: FormData): Promise<void> {
  const parsed = triageBugSchema.safeParse({ status: formData.get('status'), severity: formData.get('severity'), internalNotes: formData.get('internalNotes') });
  if (!parsed.success || !uuid.safeParse(bugId).success) redirect(`/admin/bugs/${bugId}?outcome=invalid`);
  const result = await apiSend('PUT', `/v1/admin/bugs/${bugId}`, parsed.data);
  redirect(`/admin/bugs/${bugId}?outcome=${result.kind === 'ok' ? 'ok-triaged' : result.kind}`);
}
