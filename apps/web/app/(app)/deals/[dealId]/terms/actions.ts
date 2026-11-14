'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';

const uuid = z.uuid();
const amount = z.string().transform((value) => value.trim().replace(/,/g, '')).pipe(z.string().regex(/^\d{1,18}(\.\d{1,2})?$/));

function back(dealId: string, outcome: string): never {
  redirect(`/deals/${dealId}/terms?outcome=${outcome}`);
}

/**
 * The seller's answer to each proposed term (batch 1): accept, reject, or
 * counter with an amount and a note. Terms left unanswered are not sent.
 */
export async function respondToTerms(dealId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const ordinals = [...new Set([...formData.keys()].filter((key) => key.startsWith('decision-')).map((key) => Number(key.slice(9))))].filter((ordinal) => Number.isInteger(ordinal) && ordinal >= 0);
  const responses = [];
  for (const ordinal of ordinals) {
    const decision = String(formData.get(`decision-${ordinal}`) ?? '');
    if (!['ACCEPT', 'REJECT', 'COUNTER'].includes(decision)) continue;
    const note = String(formData.get(`note-${ordinal}`) ?? '').slice(0, 1000);
    if (decision === 'COUNTER') {
      const parsed = amount.safeParse(formData.get(`counter-${ordinal}`) ?? '');
      if (!parsed.success) back(dealId, 'counter-amount');
      responses.push({ ordinal, decision, counterAmount: parsed.data, note });
    } else {
      responses.push({ ordinal, decision, note });
    }
  }
  if (responses.length === 0) back(dealId, 'nothing-chosen');
  const result = await apiSend('POST', `/v1/deals/${dealId}/terms/proposed/responses`, { responses });
  back(dealId, result.kind === 'ok' ? 'ok-sent' : result.kind === 'conflict' ? 'agreed-already' : result.kind);
}

/** Accept every term of the proposed version as it stands. */
export async function acceptAllTerms(dealId: string, ordinals: number[]): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const result = await apiSend('POST', `/v1/deals/${dealId}/terms/proposed/responses`, { responses: ordinals.map((ordinal) => ({ ordinal, decision: 'ACCEPT' })) });
  back(dealId, result.kind === 'ok' ? 'ok-sent' : result.kind === 'conflict' ? 'agreed-already' : result.kind);
}

/** The proposing side takes the other side's counters into its next version (T-107). */
export async function acceptCounters(dealId: string, batchId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(batchId).success) redirect('/deals');
  const result = await apiSend('POST', `/v1/deals/${dealId}/terms/${batchId}/accept-counters`, {});
  back(dealId, result.kind === 'ok' ? 'ok-counters' : result.kind);
}

const LEVERS = ['PURCHASE_PRICE', 'PRICE_REDUCTION', 'REMEDIATION_COST', 'ESCROW', 'INDEMNITY', 'RETENTION', 'EARNOUT', 'SELLER_FINANCING', 'FINANCING_CONTINGENCY'] as const;

/** The seller drafts their own version (T-107): the purchase price first, then any terms they ask for. */
export async function draftOwnTerms(dealId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const currency = String(formData.get('currency') ?? 'USD');
  const terms: { lever: string; amount: string; note: string; dueOn?: string }[] = [];
  for (let row = 0; row < 6; row += 1) {
    const lever = String(formData.get(`lever-${row}`) ?? '');
    const raw = String(formData.get(`amount-${row}`) ?? '').trim();
    if (!raw) continue;
    const parsed = amount.safeParse(raw);
    if (!parsed.success || !(LEVERS as readonly string[]).includes(lever)) back(dealId, 'draft-invalid');
    // A financing contingency (T-117) carries the date the financing must be in place by; nothing else does.
    const due = String(formData.get(`due-${row}`) ?? '');
    if (lever === 'FINANCING_CONTINGENCY' && !/^\d{4}-\d{2}-\d{2}$/.test(due)) back(dealId, 'draft-invalid');
    terms.push({ lever, amount: parsed.data, note: String(formData.get(`note-${row}`) ?? '').slice(0, 1000), ...(lever === 'FINANCING_CONTINGENCY' ? { dueOn: due } : {}) });
  }
  if (terms[0]?.lever !== 'PURCHASE_PRICE') back(dealId, 'draft-price-first');
  const result = await apiSend('POST', `/v1/deals/${dealId}/terms/drafts`, { currency, terms });
  back(dealId, result.kind === 'ok' ? 'ok-drafted' : result.kind === 'invalid' ? 'draft-invalid' : result.kind);
}

export async function proposeOwnTerms(dealId: string, batchId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(batchId).success) redirect('/deals');
  const result = await apiSend('POST', `/v1/deals/${dealId}/terms/${batchId}/propose`, {});
  back(dealId, result.kind === 'ok' ? 'ok-proposed' : result.kind);
}
