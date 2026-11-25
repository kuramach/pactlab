'use server';

import { ENERGY_ITEM_KINDS } from '@pactlab/domain';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost } from '../../_lib/api';

const uuid = z.uuid();
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/energy?outcome=${encodeURIComponent(outcome)}`);
const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const orNull = (value: string) => (value === '' ? null : value);
const CODES: Record<string, string> = {
  FIGURE_NOT_IN_QUOTE: 'figure',
  QUOTE_NOT_FOUND: 'citation',
  PAGE_UNAVAILABLE: 'page',
  NOT_CITABLE: 'not-citable',
  NOT_FOR_AI: 'not-for-ai',
  DETAIL: 'detail',
  VALUE: 'value',
};
const failure = (result: { kind: string; code?: string }) => (result.kind === 'invalid' ? (CODES[result.code ?? ''] ?? 'invalid') : result.kind === 'unavailable' ? 'ai-unavailable' : result.kind);

/** AI reads one report or permit; what it finds waits under "To confirm". */
export async function readDocument(dealId: string, documentId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(documentId).success) redirect('/deals');
  const result = await apiPost<{ proposed: number; rejected: unknown[] }>(`/v1/deals/${dealId}/energy/extract`, { documentId });
  back(dealId, result.kind === 'ok' ? `ok-read-${result.data.proposed}-${result.data.rejected.length}` : failure(result));
}

/** Confirm (optionally correcting the reading) or reject one proposed entry. */
export async function decideItem(dealId: string, itemId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(itemId).success) redirect('/deals');
  const decision = text(form, 'decision') === 'REJECT' ? 'REJECT' : 'CONFIRM';
  const corrected = (name: string) => (decision === 'CONFIRM' && form.has(name) ? { [name]: orNull(text(form, name)) } : {});
  const value = decision === 'CONFIRM' && text(form, 'value') ? { value: text(form, 'value') } : {};
  const result = await apiPost(`/v1/deals/${dealId}/energy/items/${itemId}/decision`, {
    decision,
    ...corrected('asset'),
    ...corrected('detail'),
    ...value,
    note: orNull(text(form, 'note')),
  });
  back(dealId, result.kind === 'ok' ? (decision === 'CONFIRM' ? 'ok-confirmed' : 'ok-rejected') : failure(result));
}

/** An entry typed by hand, still cited: the API checks the quote is on the page and holds the figure. */
export async function addItem(dealId: string, form: FormData): Promise<void> {
  const kind = text(form, 'kind');
  if (!uuid.safeParse(dealId).success || !(ENERGY_ITEM_KINDS as readonly string[]).includes(kind)) redirect('/deals');
  const result = await apiPost(`/v1/deals/${dealId}/energy/items`, {
    documentId: text(form, 'documentId'),
    pageNumber: Number(text(form, 'pageNumber') || '1'),
    quote: text(form, 'quote'),
    kind,
    asset: orNull(text(form, 'asset')),
    detail: orNull(text(form, 'detail')),
    value: text(form, 'value'),
  });
  back(dealId, result.kind === 'ok' ? 'ok-added' : failure(result));
}

/** Run the energy checks: drafts on Findings, the same as the pack's checks there. Nothing is accepted. */
export async function runChecks(dealId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const result = await apiPost<{ created: number }>(`/v1/deals/${dealId}/energy/checks`, {});
  back(dealId, result.kind === 'ok' ? `ok-checks-${result.data.created}` : failure(result));
}
