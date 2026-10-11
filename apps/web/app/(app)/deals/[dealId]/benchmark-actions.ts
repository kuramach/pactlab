'use server';

import { multipleJudgementInputSchema } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../_lib/api';

const uuid = z.uuid();
const RETURN_TO = /^\/deals\/[0-9a-f-]{36}(\/valuation)?$/;

function back(returnTo: string, outcome: string): never {
  redirect(`${RETURN_TO.test(returnTo) ? returnTo : '/deals'}?outcome=${outcome}#multiple-context`);
}

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
