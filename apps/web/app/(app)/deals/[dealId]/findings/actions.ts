'use server';

import { PRICED_RISK_TYPES, REVIEW_DECISIONS } from '@pactlab/domain';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';

const ids = z.strictObject({ dealId: z.uuid(), findingId: z.uuid() });
const version = z.coerce.number().int().positive();

function back(dealId: string, findingId: string, outcome: string): never {
  redirect(`/deals/${dealId}/findings/${findingId}?outcome=${outcome}`);
}

const decision = z.strictObject({
  decision: z.enum(REVIEW_DECISIONS),
  rationale: z.string().trim().min(1).max(4000),
  expectedVersion: version,
});

/** Submit, accept, reject or ask for support. The API checks role, status and evidence. */
export async function decideFinding(dealId: string, findingId: string, formData: FormData): Promise<void> {
  const target = ids.safeParse({ dealId, findingId });
  if (!target.success) redirect('/deals');
  const parsed = decision.safeParse({
    decision: formData.get('decision'),
    rationale: formData.get('rationale'),
    expectedVersion: formData.get('expectedVersion'),
  });
  if (!parsed.success) back(dealId, findingId, 'rationale');
  const result = await apiSend(
    'POST',
    `/v1/deals/${target.data.dealId}/findings/${target.data.findingId}/reviews`,
    parsed.data,
  );
  back(dealId, findingId, result.kind === 'ok' ? `ok-${parsed.data.decision.toLowerCase()}` : result.kind);
}

const amount = z.string().trim().regex(/^\d{1,15}(\.\d{1,4})?$/);
const pricing = z.strictObject({
  type: z.enum(PRICED_RISK_TYPES),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  low: amount,
  high: amount,
  basis: z.string().trim().min(1).max(1000),
  expectedVersion: version,
});

/** Price a draft finding's risk (or clear it). Only drafts can change. */
export async function priceFinding(dealId: string, findingId: string, formData: FormData): Promise<void> {
  const target = ids.safeParse({ dealId, findingId });
  if (!target.success) redirect('/deals');
  const path = `/v1/deals/${target.data.dealId}/findings/${target.data.findingId}`;
  if (formData.get('clear') === '1') {
    const expectedVersion = version.safeParse(formData.get('expectedVersion'));
    if (!expectedVersion.success) back(dealId, findingId, 'invalid');
    const result = await apiSend('PATCH', path, { expectedVersion: expectedVersion.data, pricedRisk: null });
    back(dealId, findingId, result.kind === 'ok' ? 'ok-cleared' : result.kind);
  }
  const parsed = pricing.safeParse({
    type: formData.get('type'),
    currency: String(formData.get('currency') ?? '').toUpperCase(),
    low: String(formData.get('low') ?? '').replaceAll(',', ''),
    high: String(formData.get('high') ?? '').replaceAll(',', ''),
    basis: formData.get('basis'),
    expectedVersion: formData.get('expectedVersion'),
  });
  if (!parsed.success) back(dealId, findingId, 'price');
  const { expectedVersion, ...pricedRisk } = parsed.data;
  const result = await apiSend('PATCH', path, { expectedVersion, pricedRisk });
  back(dealId, findingId, result.kind === 'ok' ? 'ok-priced' : result.kind);
}
