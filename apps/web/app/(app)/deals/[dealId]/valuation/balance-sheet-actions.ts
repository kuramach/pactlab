'use server';

import { balanceSheetItemInputSchema, reviseBalanceSheetItemSchema, withdrawBalanceSheetItemSchema } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';

const uuid = z.uuid();
const FIELDS = ['kind', 'category', 'label', 'amount', 'currency', 'asOf', 'documentId', 'pageNumber', 'quote', 'note'] as const;
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/valuation?outcome=${outcome}#balance-sheet`);
const read = (form: FormData, fields: readonly string[]) => Object.fromEntries(fields.map((field) => [field, form.get(field) ?? '']));

/** Record a cash, debt or debt-like item; the API checks the quote is on the cited page. */
export async function addBalanceSheetItem(dealId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const parsed = balanceSheetItemInputSchema.safeParse(read(formData, FIELDS));
  if (!parsed.success) back(dealId, `item-invalid-${String(parsed.error.issues[0]?.path[0] ?? 'form')}`);
  const result = await apiSend('POST', `/v1/deals/${dealId}/balance-sheet-items`, parsed.data);
  back(dealId, result.kind === 'ok' ? 'ok-item' : result.kind === 'invalid' ? 'item-citation' : result.kind);
}

export async function reviseBalanceSheetItem(dealId: string, itemId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(itemId).success) redirect('/deals');
  const parsed = reviseBalanceSheetItemSchema.safeParse(read(formData, [...FIELDS.filter((field) => field !== 'kind'), 'expectedVersion', 'reason']));
  if (!parsed.success) back(dealId, `item-invalid-${String(parsed.error.issues[0]?.path[0] ?? 'form')}`);
  const result = await apiSend('PUT', `/v1/deals/${dealId}/balance-sheet-items/${itemId}`, parsed.data);
  back(dealId, result.kind === 'ok' ? 'ok-item-revised' : result.kind === 'invalid' ? 'item-citation' : result.kind);
}

export async function withdrawBalanceSheetItem(dealId: string, itemId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(itemId).success) redirect('/deals');
  const parsed = withdrawBalanceSheetItemSchema.safeParse(read(formData, ['expectedVersion', 'reason']));
  if (!parsed.success) back(dealId, 'item-invalid-reason');
  const result = await apiSend('POST', `/v1/deals/${dealId}/balance-sheet-items/${itemId}/withdraw`, parsed.data);
  back(dealId, result.kind === 'ok' ? 'ok-item-withdrawn' : result.kind);
}
