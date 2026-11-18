'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost } from '../../_lib/api';

const uuid = z.uuid();
const KINDS = ['REPORTED_EBITDA', 'ADJUSTMENT', 'ADD_BACK', 'WORKING_CAPITAL'] as const;
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/qoe?outcome=${encodeURIComponent(outcome)}`);
const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const citation = (form: FormData, prefix = '') => ({ documentId: text(form, `${prefix}documentId`), pageNumber: Number(text(form, `${prefix}pageNumber`) || '1'), quote: text(form, `${prefix}quote`) });
const CODES: Record<string, string> = { QUOTE_NOT_FOUND: 'citation', PAGE_UNAVAILABLE: 'page', PEOPLE_DATA: 'people-data', CURRENCY_MISMATCH: 'currency', NO_PEG: 'no-peg' };

/** Record one cited QoE entry. The API checks every quote is on its page; the figures are never computed here. */
export async function addEntry(dealId: string, kind: (typeof KINDS)[number], form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success || !KINDS.includes(kind)) redirect('/deals');
  const common = { kind, label: text(form, 'label'), amount: text(form, 'amount'), currency: text(form, 'currency'), citation: citation(form) };
  const status = text(form, 'verificationStatus');
  const body =
    kind === 'WORKING_CAPITAL'
      ? { ...common, periodEnd: text(form, 'periodEnd'), category: text(form, 'category') }
      : kind === 'REPORTED_EBITDA'
        ? { ...common, period: text(form, 'period') }
        : kind === 'ADJUSTMENT'
          ? { ...common, period: text(form, 'period'), category: text(form, 'category'), rationale: text(form, 'rationale') }
          : {
              ...common,
              period: text(form, 'period'),
              category: text(form, 'category'),
              rationale: text(form, 'rationale'),
              recurrence: text(form, 'recurrence'),
              verificationStatus: status,
              ...(status === 'PARTIALLY_VERIFIED' ? { verifiedAmount: text(form, 'verifiedAmount') } : {}),
              ...(status !== 'UNVERIFIED' ? { verificationCitation: citation(form, 'v-') } : {}),
            };
  const result = await apiPost(`/v1/deals/${dealId}/qoe/entries`, body);
  back(dealId, result.kind === 'ok' ? 'ok-entry' : result.kind === 'invalid' ? (CODES[result.code ?? ''] ?? 'invalid') : result.kind);
}

/** A reviewer's explicit include or exclude of an add-back, with the reason. Recorded and audited by the API. */
export async function decideAddBack(dealId: string, entryKey: string, expectedVersion: number, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(entryKey).success) redirect('/deals');
  const decision = text(form, 'decision');
  const result = await apiPost(`/v1/deals/${dealId}/qoe/entries/${entryKey}/decision`, { decision, reason: text(form, 'reason'), expectedVersion });
  back(dealId, result.kind === 'ok' ? (decision === 'INCLUDE' ? 'ok-included' : 'ok-excluded') : result.kind === 'invalid' ? 'decision-invalid' : result.kind);
}

/** Put the proposed peg on the open draft terms; the amount comes from the API's analysis, not this form. */
export async function addPegTerm(dealId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const result = await apiPost(`/v1/deals/${dealId}/qoe/peg-term`, {});
  back(dealId, result.kind === 'ok' ? 'ok-peg' : result.kind === 'conflict' ? 'peg-conflict' : result.kind === 'invalid' ? (CODES[result.code ?? ''] ?? 'invalid') : result.kind);
}
