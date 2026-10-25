'use server';

import { balanceSheetItemInputSchema, reviseBalanceSheetItemSchema, withdrawBalanceSheetItemSchema } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiGet, apiSend } from '../../_lib/api';
import { itemError, normalizeAmount, type ItemFormState } from './balance-sheet-form-state';

const uuid = z.uuid();
const FIELDS = [
  'kind', 'category', 'label', 'amount', 'currency', 'asOf', 'documentId', 'pageNumber', 'quote', 'note',
  // Loan terms (debt items only); blank means not recorded.
  'interestRatePercent', 'rateType', 'rateReference', 'maturityDate', 'lender', 'repayment', 'covenantNote',
] as const;
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/valuation?outcome=${outcome}#balance-sheet`);
const read = (form: FormData, fields: readonly string[]) =>
  Object.fromEntries(fields.map((field) => [field, String(form.get(field) ?? '')])) as Record<string, string>;

/**
 * Record a cash, debt or debt-like item; the API checks the quote is on the
 * cited page. On any refusal the form keeps what was typed and names the
 * field to fix; only a saved item leaves the form.
 */
export async function addBalanceSheetItem(dealId: string, _state: ItemFormState, formData: FormData): Promise<ItemFormState> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const values = read(formData, FIELDS);
  const parsed = balanceSheetItemInputSchema.safeParse({ ...values, amount: normalizeAmount(values['amount'] ?? '') });
  if (!parsed.success) return itemError(values, { field: String(parsed.error.issues[0]?.path[0] ?? 'form') });
  const result = await apiSend('POST', `/v1/deals/${dealId}/balance-sheet-items`, parsed.data);
  if (result.kind !== 'ok') return itemError(values, { result: result.kind, code: 'code' in result ? result.code : undefined });
  return back(dealId, 'ok-item');
}

export async function reviseBalanceSheetItem(dealId: string, itemId: string, _state: ItemFormState, formData: FormData): Promise<ItemFormState> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(itemId).success) redirect('/deals');
  const values = read(formData, [...FIELDS.filter((field) => field !== 'kind'), 'expectedVersion', 'reason']);
  const parsed = reviseBalanceSheetItemSchema.safeParse({ ...values, amount: normalizeAmount(values['amount'] ?? '') });
  if (!parsed.success) return itemError(values, { field: String(parsed.error.issues[0]?.path[0] ?? 'form') });
  const result = await apiSend('PUT', `/v1/deals/${dealId}/balance-sheet-items/${itemId}`, parsed.data);
  if (result.kind !== 'ok') return itemError(values, { result: result.kind, code: 'code' in result ? result.code : undefined });
  return back(dealId, 'ok-item-revised');
}

export async function withdrawBalanceSheetItem(dealId: string, itemId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(itemId).success) redirect('/deals');
  const parsed = withdrawBalanceSheetItemSchema.safeParse(read(formData, ['expectedVersion', 'reason']));
  if (!parsed.success) back(dealId, 'item-invalid-reason');
  const result = await apiSend('POST', `/v1/deals/${dealId}/balance-sheet-items/${itemId}/withdraw`, parsed.data);
  back(dealId, result.kind === 'ok' ? 'ok-item-withdrawn' : result.kind);
}

/** The text of one document page, so the quote can be picked instead of retyped. */
export async function loadPageText(dealId: string, documentId: string, pageNumber: number): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(documentId).success || !Number.isInteger(pageNumber) || pageNumber < 1)
    return { ok: false, message: 'Choose a document and a page first.' };
  const page = await apiGet<{ text: string | null }>(`/v1/deals/${dealId}/documents/${documentId}/pages/${pageNumber}`);
  if (page.kind === 'not-found') return { ok: false, message: `That document has no page ${pageNumber}.` };
  if (page.kind !== 'ok') return { ok: false, message: 'The page could not be read (it may be people data, purged or unavailable).' };
  return page.data.text ? { ok: true, text: page.data.text } : { ok: false, message: 'This page has no readable text.' };
}
