'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';

/** Buyer financing (T-117). The API checks side and role on every step; these only shape the forms. */
const uuid = z.uuid();
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/financing?outcome=${outcome}`);
const outcomeOf = (result: { kind: string; code?: string }, ok: string) => (result.kind === 'ok' ? ok : result.code ? `error-${result.code}` : result.kind);
const ids = (...values: (string | null)[]) => {
  if (!values.every((value) => value === null || uuid.safeParse(value).success)) redirect('/deals');
};
const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();
const date = (formData: FormData, name: string) => (/^\d{4}-\d{2}-\d{2}$/.test(text(formData, name)) ? text(formData, name) : null);
const amount = (formData: FormData, name: string) => text(formData, name).replace(/[,\s]/g, '');

export async function savePlan(dealId: string, formData: FormData): Promise<void> {
  ids(dealId);
  back(dealId, outcomeOf(await apiSend('PUT', `/v1/deals/${dealId}/financing`, { commitmentExpectedBy: date(formData, 'commitmentExpectedBy'), buyerNote: text(formData, 'buyerNote') }), 'ok-saved'));
}

function tranche(formData: FormData) {
  return { kind: text(formData, 'kind'), amount: amount(formData, 'amount'), currency: text(formData, 'currency').toUpperCase() || 'USD', status: text(formData, 'status'), label: text(formData, 'label'), buyerNote: text(formData, 'buyerNote') };
}

export async function addTranche(dealId: string, formData: FormData): Promise<void> {
  ids(dealId);
  back(dealId, outcomeOf(await apiSend('POST', `/v1/deals/${dealId}/financing/tranches`, tranche(formData)), 'ok-saved'));
}

export async function updateTranche(dealId: string, trancheId: string, formData: FormData): Promise<void> {
  ids(dealId, trancheId);
  back(dealId, outcomeOf(await apiSend('PUT', `/v1/deals/${dealId}/financing/tranches/${trancheId}`, tranche(formData)), 'ok-saved'));
}

export async function removeTranche(dealId: string, trancheId: string): Promise<void> {
  ids(dealId, trancheId);
  back(dealId, outcomeOf(await apiSend('DELETE', `/v1/deals/${dealId}/financing/tranches/${trancheId}`, {}), 'ok-removed'));
}

const MAX = 10 * 1024 * 1024;
export async function attachDocument(dealId: string, formData: FormData): Promise<void> {
  ids(dealId);
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) back(dealId, 'error-NO_FILE');
  const pdf = file as File;
  if (pdf.size > MAX) back(dealId, 'error-TOO_LARGE');
  const trancheId = text(formData, 'trancheId') || null;
  ids(trancheId);
  const result = await apiSend('POST', `/v1/deals/${dealId}/financing/documents`, {
    purpose: text(formData, 'purpose'),
    trancheId,
    fileName: pdf.name,
    contentType: 'application/pdf',
    contentBase64: Buffer.from(await pdf.arrayBuffer()).toString('base64'),
  });
  back(dealId, outcomeOf(result, 'ok-attached'));
}

export async function shareDocument(dealId: string, documentId: string, shared: boolean): Promise<void> {
  ids(dealId, documentId);
  back(dealId, outcomeOf(await apiSend('PUT', `/v1/deals/${dealId}/financing/documents/${documentId}/sharing`, { shared }), shared ? 'ok-shared' : 'ok-unshared'));
}

export async function saveEscrow(dealId: string, formData: FormData): Promise<void> {
  ids(dealId);
  const body = {
    amount: amount(formData, 'amount'),
    currency: text(formData, 'currency').toUpperCase() || 'USD',
    holderKind: text(formData, 'holderKind'),
    holderName: text(formData, 'holderName'),
    depositDueOn: date(formData, 'depositDueOn'),
    hardOn: date(formData, 'hardOn'),
    refundConditions: text(formData, 'refundConditions'),
  };
  back(dealId, outcomeOf(await apiSend('PUT', `/v1/deals/${dealId}/financing/escrow`, body), 'ok-saved'));
}

export async function recordDeposit(dealId: string, formData: FormData): Promise<void> {
  ids(dealId);
  const proof = text(formData, 'proofDocumentId') || null;
  ids(proof);
  back(dealId, outcomeOf(await apiSend('POST', `/v1/deals/${dealId}/financing/escrow/deposit`, { depositedOn: date(formData, 'depositedOn'), reference: text(formData, 'reference'), proofDocumentId: proof }), 'ok-deposited'));
}

export async function confirmDeposit(dealId: string, planId: string): Promise<void> {
  ids(dealId, planId);
  back(dealId, outcomeOf(await apiSend('POST', `/v1/deals/${dealId}/financing/plans/${planId}/escrow/confirm`, {}), 'ok-confirmed'));
}

export async function disputeDeposit(dealId: string, planId: string, formData: FormData): Promise<void> {
  ids(dealId, planId);
  back(dealId, outcomeOf(await apiSend('POST', `/v1/deals/${dealId}/financing/plans/${planId}/escrow/dispute`, { note: text(formData, 'note') }), 'ok-disputed'));
}

export async function recordDisposition(dealId: string, planId: string | null, disposition: 'APPLIED_AT_CLOSE' | 'RELEASED_TO_SELLER' | 'REFUNDED_TO_BUYER'): Promise<void> {
  ids(dealId, planId);
  const path = planId ? `/v1/deals/${dealId}/financing/plans/${planId}/escrow/disposition` : `/v1/deals/${dealId}/financing/escrow/disposition`;
  back(dealId, outcomeOf(await apiSend('POST', path, { disposition }), 'ok-disposed'));
}
