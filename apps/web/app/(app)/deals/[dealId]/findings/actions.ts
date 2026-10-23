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

const directionField = z.enum(['-1', '0', '1']).transform((value) => Number(value) as -1 | 0 | 1);

const decision = z.strictObject({
  decision: z.enum(REVIEW_DECISIONS),
  rationale: z.string().trim().min(1).max(4000),
  expectedVersion: version,
  /** On acceptance: empty keeps the proposed direction. */
  direction: directionField.optional(),
  directionRationale: z.string().trim().min(1).max(4000).optional(),
});

const blank = (value: FormDataEntryValue | null) => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** Submit, accept, reject or ask for support. The API checks role, status and evidence. */
export async function decideFinding(dealId: string, findingId: string, formData: FormData): Promise<void> {
  const target = ids.safeParse({ dealId, findingId });
  if (!target.success) redirect('/deals');
  const accepting = formData.get('decision') === 'ACCEPTED';
  const parsed = decision.safeParse({
    decision: formData.get('decision'),
    rationale: formData.get('rationale'),
    expectedVersion: formData.get('expectedVersion'),
    ...(accepting ? { direction: blank(formData.get('direction')), directionRationale: blank(formData.get('directionRationale')) } : {}),
  });
  if (!parsed.success) back(dealId, findingId, 'rationale');
  const result = await apiSend(
    'POST',
    `/v1/deals/${target.data.dealId}/findings/${target.data.findingId}/reviews`,
    parsed.data,
  );
  if (result.kind === 'invalid' && result.code) back(dealId, findingId, `rule-${result.code}`);
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

const directionForm = z.strictObject({
  expectedVersion: version,
  direction: directionField,
  valueDriver: z.string().trim().max(200).optional(),
  valueBasis: z.string().trim().max(2000).optional(),
  valueLow: amount.optional(),
  valueHigh: amount.optional(),
  valueCurrency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  directionRationale: z.string().trim().max(4000).optional(),
});

/**
 * Propose a draft's direction. A cushion says which value driver it confirms
 * (optionally an implied range); a neutral says why; only a drag keeps a price,
 * so choosing cushion or neutral removes any price on the draft.
 */
export async function setFindingDirection(dealId: string, findingId: string, formData: FormData): Promise<void> {
  const target = ids.safeParse({ dealId, findingId });
  if (!target.success) redirect('/deals');
  const field = (name: string) => blank(formData.get(name));
  const parsed = directionForm.safeParse({
    expectedVersion: formData.get('expectedVersion'),
    direction: formData.get('direction'),
    valueDriver: field('valueDriver'),
    valueBasis: field('valueBasis'),
    valueLow: field('valueLow')?.toString().replaceAll(',', ''),
    valueHigh: field('valueHigh')?.toString().replaceAll(',', ''),
    valueCurrency: field('valueCurrency')?.toString().toUpperCase(),
    directionRationale: field('directionRationale'),
  });
  if (!parsed.success) back(dealId, findingId, 'direction');
  const { expectedVersion, direction, valueDriver, valueBasis, valueLow, valueHigh, valueCurrency, directionRationale } = parsed.data;
  if (direction === 1 && (!valueDriver || !valueBasis)) back(dealId, findingId, 'direction-cushion');
  if (direction === 0 && !directionRationale) back(dealId, findingId, 'direction-neutral');
  const implied = valueLow && valueHigh ? { low: valueLow, high: valueHigh, currency: valueCurrency ?? 'USD' } : null;
  const result = await apiSend('PATCH', `/v1/deals/${target.data.dealId}/findings/${target.data.findingId}`, {
    expectedVersion,
    direction,
    ...(direction === -1 ? {} : { pricedRisk: null }),
    valueConfirmation: direction === 1 ? { valueDriver, basis: valueBasis, impliedValue: implied } : null,
    directionRationale: directionRationale ?? null,
  });
  back(dealId, findingId, result.kind === 'ok' ? 'ok-direction' : result.kind === 'invalid' ? 'direction' : result.kind);
}

const deal = z.uuid();

/** Run the deal's industry-pack checks (deterministic rules; drafts only), then show what they proposed. */
export async function runIndustryChecks(dealId: string): Promise<void> {
  const parsed = deal.safeParse(dealId);
  if (!parsed.success) redirect('/deals');
  const result = await apiSend<{ created: number; existing: number; unresolvedQuotes: number }>(
    'POST',
    `/v1/deals/${parsed.data}/findings/pack-rules/run`,
    {},
  );
  const base = `/deals/${parsed.data}/findings`;
  if (result.kind !== 'ok') redirect(`${base}?checks=${result.kind === 'forbidden' ? 'forbidden' : 'error'}`);
  redirect(`${base}?checks=ok&created=${result.data.created}&existing=${result.data.existing}&unresolved=${result.data.unresolvedQuotes}`);
}
