'use server';

import { OFFERING_ITEM_KINDS, OFFERING_SOURCES } from '@pactlab/domain';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost, apiSend } from '../../_lib/api';

const uuid = z.uuid();
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/syndication?outcome=${encodeURIComponent(outcome)}`);
const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const orNull = (value: string) => (value === '' ? null : value);
const CODES: Record<string, string> = {
  FIGURE_NOT_IN_QUOTE: 'figure',
  QUOTE_NOT_FOUND: 'citation',
  PAGE_UNAVAILABLE: 'page',
  NOT_CITABLE: 'not-citable',
  NOT_FOR_AI: 'not-for-ai',
  LOAN_ABOVE_PRICE: 'loan',
  LABEL: 'label',
  HURDLE: 'hurdle',
  VALUE: 'value',
};
const failure = (result: { kind: string; code?: string }) => (result.kind === 'invalid' ? (CODES[result.code ?? ''] ?? 'invalid') : result.kind === 'unavailable' ? 'ai-unavailable' : result.kind);

/** The offering the waterfall is recomputed on. Figures are typed, never computed here. */
export async function saveOffering(dealId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const result = await apiSend('PUT', `/v1/deals/${dealId}/syndication/offering`, {
    currency: text(form, 'currency'),
    purchasePrice: text(form, 'purchasePrice'),
    loanAmount: text(form, 'loanAmount'),
    interestRatePct: text(form, 'interestRatePct'),
    equityRaise: text(form, 'equityRaise'),
    holdYears: Number(text(form, 'holdYears')),
    sellingCostsPct: text(form, 'sellingCostsPct'),
    noiYear1: orNull(text(form, 'noiYear1')),
    downsideNoiGrowthPct: text(form, 'downsideNoiGrowthPct'),
    baseNoiGrowthPct: text(form, 'baseNoiGrowthPct'),
    upsideNoiGrowthPct: text(form, 'upsideNoiGrowthPct'),
    downsideExitCapPct: text(form, 'downsideExitCapPct'),
    baseExitCapPct: text(form, 'baseExitCapPct'),
    upsideExitCapPct: text(form, 'upsideExitCapPct'),
    exemption: text(form, 'exemption'),
  });
  back(dealId, result.kind === 'ok' ? 'ok-offering' : failure(result));
}

/** AI reads one offering document; what it finds waits under "To confirm". */
export async function readDocument(dealId: string, documentId: string, form: FormData): Promise<void> {
  const source = text(form, 'source');
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(documentId).success || !(OFFERING_SOURCES as readonly string[]).includes(source)) redirect('/deals');
  const result = await apiPost<{ proposed: number; rejected: unknown[] }>(`/v1/deals/${dealId}/syndication/extract`, { documentId, source });
  back(dealId, result.kind === 'ok' ? `ok-read-${result.data.proposed}-${result.data.rejected.length}` : failure(result));
}

/** Confirm (optionally correcting the figure) or reject one proposed item. */
export async function decideItem(dealId: string, itemId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(itemId).success) redirect('/deals');
  const decision = text(form, 'decision') === 'REJECT' ? 'REJECT' : 'CONFIRM';
  const value = text(form, 'value');
  const hurdle = text(form, 'hurdle');
  const result = await apiPost(`/v1/deals/${dealId}/syndication/items/${itemId}/decision`, {
    decision,
    ...(decision === 'CONFIRM' && value !== '' ? { value } : {}),
    ...(decision === 'CONFIRM' && form.has('hurdle') ? { hurdle: orNull(hurdle) } : {}),
    note: orNull(text(form, 'note')),
  });
  back(dealId, result.kind === 'ok' ? (decision === 'CONFIRM' ? 'ok-confirmed' : 'ok-rejected') : failure(result));
}

/** A term or claim typed by hand, still cited: the API checks the quote is on the page and holds every figure. */
export async function addItem(dealId: string, form: FormData): Promise<void> {
  const kind = text(form, 'kind');
  const source = text(form, 'source');
  if (!uuid.safeParse(dealId).success || !(OFFERING_ITEM_KINDS as readonly string[]).includes(kind) || !(OFFERING_SOURCES as readonly string[]).includes(source)) redirect('/deals');
  const result = await apiPost(`/v1/deals/${dealId}/syndication/items`, {
    documentId: text(form, 'documentId'),
    pageNumber: Number(text(form, 'pageNumber') || '1'),
    quote: text(form, 'quote'),
    source,
    kind,
    label: orNull(text(form, 'label')),
    value: orNull(text(form, 'value')),
    hurdle: orNull(text(form, 'hurdle')),
  });
  back(dealId, result.kind === 'ok' ? 'ok-added' : failure(result));
}

/** Run the offering checks: drafts on Findings, outcomes in the claims register. Nothing is accepted. */
export async function runChecks(dealId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const result = await apiPost<{ created: number }>(`/v1/deals/${dealId}/syndication/checks`, {});
  back(dealId, result.kind === 'ok' ? `ok-checks-${result.data.created}` : failure(result));
}
