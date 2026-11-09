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

/** MCP for an organization (T-084): AI apps such as Claude may connect only once this is on. */
export async function setOrganizationMcp(organizationId: string, enabled: boolean): Promise<void> {
  if (!uuid.safeParse(organizationId).success) return back('organizations', 'invalid');
  const result = await apiSend('PUT', `/v1/admin/organizations/${organizationId}/mcp`, { enabled });
  back('organizations', result.kind === 'ok' ? 'ok-mcp' : result.kind);
}

export async function setMemberStatus(organizationId: string, userId: string, formData: FormData): Promise<void> {
  const parsed = memberStatusSchema.safeParse({ status: formData.get('status') });
  if (!parsed.success || !uuid.safeParse(organizationId).success || !uuid.safeParse(userId).success) return back('users', 'invalid');
  const result = await apiSend('PUT', `/v1/admin/organizations/${organizationId}/members/${userId}/status`, parsed.data);
  back('users', result.kind === 'ok' ? 'ok-member' : result.kind);
}

export async function triageBug(bugId: string, formData: FormData): Promise<void> {
  const parsed = triageBugSchema.safeParse({ status: formData.get('status'), severity: formData.get('severity'), internalNotes: formData.get('internalNotes'), reporterNote: formData.get('reporterNote') });
  if (!parsed.success || !uuid.safeParse(bugId).success) redirect(`/admin/bugs/${bugId}?outcome=invalid`);
  const result = await apiSend('PUT', `/v1/admin/bugs/${bugId}`, parsed.data);
  redirect(`/admin/bugs/${bugId}?outcome=${result.kind === 'ok' ? 'ok-triaged' : result.kind}`);
}

// --- Billing and promo codes (T-087) ----------------------------------------------------------

const optional = (formData: FormData, name: string) => {
  const value = String(formData.get(name) ?? '').trim();
  return value === '' ? null : value;
};

/** A promo code: a discount (mirrored to Stripe) or free pacts, optionally for some packs and dates. */
export async function createPromoCode(formData: FormData): Promise<void> {
  const kind = formData.get('kind') === 'DISCOUNT' ? 'DISCOUNT' : 'FREE_PACTS';
  const number = (name: string) => (optional(formData, name) ? Number(optional(formData, name)) : null);
  const body = {
    code: String(formData.get('code') ?? '').trim().toUpperCase(),
    description: String(formData.get('description') ?? '').trim(),
    kind,
    ...(kind === 'DISCOUNT'
      ? {
          percentOff: optional(formData, 'percentOff'),
          amountOff: optional(formData, 'amountOff'),
          currency: optional(formData, 'amountOff') ? 'USD' : null,
          duration: optional(formData, 'duration') ?? 'ONCE',
          durationMonths: optional(formData, 'duration') === 'REPEATING' ? number('durationMonths') : null,
          planKeys: formData.getAll('planKeys').map(String),
        }
      : { freePacts: number('freePacts'), packs: formData.getAll('packs').map(String) }),
    validFrom: optional(formData, 'validFrom'),
    validUntil: optional(formData, 'validUntil'),
    maxRedemptions: number('maxRedemptions'),
    skipsApproval: formData.get('skipsApproval') === 'on',
  };
  const result = await apiSend('POST', '/v1/admin/promo-codes', body);
  back('promo', result.kind === 'ok' ? 'ok-promo' : result.kind === 'invalid' && result.code === 'PROMO_CODE_TAKEN' ? 'promo-taken' : 'invalid');
}

export async function deactivatePromoCode(id: string): Promise<void> {
  if (!uuid.safeParse(id).success) return back('promo', 'invalid');
  const result = await apiSend('POST', `/v1/admin/promo-codes/${id}/deactivate`, {});
  back('promo', result.kind === 'ok' ? 'ok-promo-off' : result.kind);
}

/** Give an organization one pact for free (support), audited. */
export async function compPact(organizationId: string): Promise<void> {
  if (!uuid.safeParse(organizationId).success) return back('organizations', 'invalid');
  const result = await apiSend('POST', `/v1/admin/organizations/${organizationId}/billing/comp`, { kind: 'PACT' });
  back('organizations', result.kind === 'ok' ? 'ok-comp' : result.kind);
}

/** Re-mirror an organization's subscription from Stripe. */
export async function resyncBilling(organizationId: string): Promise<void> {
  if (!uuid.safeParse(organizationId).success) return back('organizations', 'invalid');
  const result = await apiSend('POST', `/v1/admin/organizations/${organizationId}/billing/resync`, {});
  back('organizations', result.kind === 'ok' ? 'ok-resync' : result.kind);
}
