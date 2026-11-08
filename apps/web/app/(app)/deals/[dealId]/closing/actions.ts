'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';

/** The two-sided close (T-107). Every action goes through the API, which re-checks the side and role. */
const uuid = z.uuid();
const amount = z.string().transform((value) => value.trim().replace(/,/g, '')).pipe(z.string().regex(/^\d{1,18}(\.\d{1,2})?$/));

function back(dealId: string, outcome: string): never {
  redirect(`/deals/${dealId}/closing?outcome=${outcome}`);
}

function ids(...values: string[]) {
  if (!values.every((value) => uuid.safeParse(value).success)) redirect('/deals');
}

const kind = (result: { kind: string; code?: string }) => (result.kind === 'ok' ? 'ok' : result.code ? `error-${result.code}` : result.kind);

export async function nameSignatory(dealId: string, side: 'BUYER' | 'SELLER', formData: FormData): Promise<void> {
  ids(dealId);
  const userId = String(formData.get('userId') ?? '');
  if (!uuid.safeParse(userId).success) back(dealId, 'invalid');
  const result = await apiSend('PUT', `/v1/deals/${dealId}/signatories/${side}`, { userId });
  back(dealId, result.kind === 'ok' ? 'ok-signatory' : kind(result));
}

export async function signOff(dealId: string, batchId: string): Promise<void> {
  ids(dealId, batchId);
  back(dealId, ((r) => (r.kind === 'ok' ? 'ok-signed' : kind(r)))(await apiSend('POST', `/v1/deals/${dealId}/terms/${batchId}/signoff`, {})));
}

export async function declineTerms(dealId: string, batchId: string): Promise<void> {
  ids(dealId, batchId);
  back(dealId, ((r) => (r.kind === 'ok' ? 'ok-declined' : kind(r)))(await apiSend('POST', `/v1/deals/${dealId}/terms/${batchId}/decline`, {})));
}

export async function sendForSignature(dealId: string, batchId: string, formData: FormData): Promise<void> {
  ids(dealId, batchId);
  const attached = String(formData.get('agreementDocumentId') ?? '');
  const result = await apiSend('POST', `/v1/deals/${dealId}/terms/${batchId}/esign`, { agreementDocumentId: uuid.safeParse(attached).success ? attached : null });
  back(dealId, result.kind === 'ok' ? 'ok-sent' : kind(result));
}

/** Fixture e-signature, outside production: sign as your side's signatory. */
export async function fixtureSign(dealId: string, batchId: string): Promise<void> {
  ids(dealId, batchId);
  back(dealId, ((r) => (r.kind === 'ok' ? 'ok-esigned' : kind(r)))(await apiSend('POST', `/v1/deals/${dealId}/terms/${batchId}/esign/fixture-sign`, {})));
}

export async function addItem(dealId: string, formData: FormData): Promise<void> {
  ids(dealId);
  const title = String(formData.get('title') ?? '').trim();
  const funds = formData.get('kind') === 'FUNDS';
  let body: Record<string, string>;
  if (funds) {
    const parsed = amount.safeParse(formData.get('amount') ?? '');
    if (!parsed.success) back(dealId, 'item-amount');
    body = { kind: 'FUNDS', title: title || 'Purchase price at completion', amount: parsed.data, currency: String(formData.get('currency') ?? 'USD') };
  } else {
    if (title.length < 2) back(dealId, 'item-title');
    body = { kind: 'CONDITION', title, ownerSide: formData.get('ownerSide') === 'SELLER' ? 'SELLER' : 'BUYER' };
  }
  const result = await apiSend('POST', `/v1/deals/${dealId}/closing-items`, body);
  back(dealId, result.kind === 'ok' ? 'ok-item' : kind(result));
}

export async function tickItem(dealId: string, itemId: string): Promise<void> {
  ids(dealId, itemId);
  back(dealId, ((r) => (r.kind === 'ok' ? 'ok-ticked' : kind(r)))(await apiSend('POST', `/v1/deals/${dealId}/closing-items/${itemId}/done`, {})));
}

export async function recordPayment(dealId: string, itemId: string, formData: FormData): Promise<void> {
  ids(dealId, itemId);
  const paidOn = String(formData.get('paidOn') ?? '');
  const reference = String(formData.get('reference') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || !reference) back(dealId, 'paid-invalid');
  const proof = String(formData.get('proofDocumentId') ?? '');
  const result = await apiSend('POST', `/v1/deals/${dealId}/closing-items/${itemId}/paid`, { paidOn, reference, proofDocumentId: uuid.safeParse(proof).success ? proof : null });
  back(dealId, result.kind === 'ok' ? 'ok-paid' : kind(result));
}

export async function disputePayment(dealId: string, itemId: string, formData: FormData): Promise<void> {
  ids(dealId, itemId);
  const note = String(formData.get('note') ?? '').trim();
  if (note.length < 3) back(dealId, 'dispute-note');
  back(dealId, ((r) => (r.kind === 'ok' ? 'ok-disputed' : kind(r)))(await apiSend('POST', `/v1/deals/${dealId}/closing-items/${itemId}/dispute`, { note })));
}

export async function closeDeal(dealId: string): Promise<void> {
  ids(dealId);
  const result = await apiSend('POST', `/v1/deals/${dealId}/close`, {});
  if (result.kind === 'ok') redirect(`/deals/${dealId}/post-close?outcome=ok-closed`);
  back(dealId, kind(result));
}
