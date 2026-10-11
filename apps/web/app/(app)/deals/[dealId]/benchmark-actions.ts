'use server';

import { anchorInputSchema, multipleJudgementInputSchema } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../_lib/api';

const uuid = z.uuid();
const RETURN_TO = /^\/deals\/[0-9a-f-]{36}(\/valuation)?$/;

function backTo(returnTo: string, outcome: string, anchor: string): never {
  redirect(`${RETURN_TO.test(returnTo) ? returnTo : '/deals'}?outcome=${outcome}#${anchor}`);
}

const back = (returnTo: string, outcome: string): never => backTo(returnTo, outcome, 'multiple-context');

/** The deal lead's call on the asking price, bound by the API to the benchmark it was made against. */
export async function recordMultipleJudgement(dealId: string, returnTo: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const parsed = multipleJudgementInputSchema.safeParse({
    verdict: formData.get('verdict'),
    rationale: formData.get('rationale'),
    scenarioId: formData.get('scenarioId') || undefined,
    companyType: formData.get('companyType') || undefined,
    years: formData.get('years') || undefined,
    synthetic: formData.get('synthetic') || undefined,
  });
  if (!parsed.success) back(returnTo, 'judgement-rationale');
  const result = await apiSend('POST', `/v1/deals/${dealId}/multiple-judgements`, parsed.data);
  back(returnTo, result.kind === 'ok' ? 'ok-judged' : result.kind);
}

/** Add this deal to the firm's precedents from its approved valuation. */
export async function addDealToPrecedents(dealId: string, returnTo: string): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const result = await apiSend('POST', `/v1/deals/${dealId}/comparables/from-deal`, {});
  back(returnTo, result.kind === 'ok' ? 'ok-precedent' : result.kind === 'conflict' ? 'precedent-exists' : result.kind);
}

/** Cite a comparable against the ask. The API refuses the firm's own deals. */
export async function addAnchor(dealId: string, returnTo: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const parsed = anchorInputSchema.safeParse({ comparableId: formData.get('comparableId'), note: formData.get('note') ?? '' });
  if (!parsed.success) backTo(returnTo, 'anchor-choose', 'negotiation-anchors');
  const result = await apiSend('POST', `/v1/deals/${dealId}/anchors`, parsed.data);
  backTo(returnTo, result.kind === 'ok' ? 'ok-anchor' : result.kind === 'conflict' ? 'anchor-exists' : result.kind === 'invalid' ? 'anchor-refused' : result.kind, 'negotiation-anchors');
}

export async function removeAnchor(dealId: string, anchorId: string, returnTo: string): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(anchorId).success) redirect('/deals');
  const result = await apiSend('POST', `/v1/deals/${dealId}/anchors/${anchorId}/remove`, {});
  backTo(returnTo, result.kind === 'ok' ? 'ok-anchor-removed' : result.kind, 'negotiation-anchors');
}
