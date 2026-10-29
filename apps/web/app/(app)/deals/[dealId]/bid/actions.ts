'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { StartPactCommand } from '@pactlab/contracts';
import { authApi, nativeSessionToken, storeNativeSession, type IssuedSession } from '../../../../../lib/native-session';
import { getMe } from '../../../../../lib/session';
import { apiGet, apiPost, dealsApi } from '../../_lib/api';

const uuid = z.uuid();

function back(dealId: string, outcome: string): never {
  redirect(`/deals/${dealId}/bid?outcome=${encodeURIComponent(outcome)}`);
}

const kind = (result: { kind: string }, ok: string) => (result.kind === 'ok' ? ok : result.kind === 'conflict' ? 'conflict' : result.kind === 'invalid' ? 'invalid' : result.kind === 'forbidden' ? 'forbidden' : 'error');

export async function acceptNda(dealId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  back(dealId, kind(await apiPost(`/v1/deals/${dealId}/my-bid/nda`, {}), 'ok-nda'));
}

export async function askQuestion(dealId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const question = String(form.get('question') ?? '').trim();
  if (question.length < 3) back(dealId, 'question-short');
  back(dealId, kind(await apiPost(`/v1/deals/${dealId}/my-bid/questions`, { question }), 'ok-asked'));
}

const amount = (value: FormDataEntryValue | null) => String(value ?? '').replaceAll(',', '').trim();

/** Submit or revise an offer; every version is kept. */
export async function submitOffer(dealId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const preMoney = amount(form.get('preMoney'));
  const conditions = String(form.get('conditions') ?? '').trim();
  const validUntil = String(form.get('validUntil') ?? '').trim();
  const result = await apiPost(`/v1/deals/${dealId}/my-bid/offers`, {
    price: amount(form.get('price')),
    currency: String(form.get('currency') ?? 'USD'),
    structure: String(form.get('structure') ?? '').trim(),
    ...(preMoney ? { preMoney } : {}),
    ...(conditions ? { conditions } : {}),
    ...(validUntil ? { validUntil } : {}),
  });
  back(dealId, result.kind === 'invalid' ? 'offer-invalid' : kind(result, 'ok-offered'));
}

export async function passBid(dealId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const reason = String(form.get('reason') ?? '').trim();
  back(dealId, kind(await apiPost(`/v1/deals/${dealId}/my-bid/pass`, reason ? { reason } : {}), 'ok-passed'));
}

/** Comment on a shared document (or follow up in your thread). Only the seller and your firm see it. */
export async function commentOnDocument(dealId: string, documentId: string, parentId: string | null, form: FormData): Promise<void> {
  if (![dealId, documentId].every((id) => uuid.safeParse(id).success) || (parentId && !uuid.safeParse(parentId).success)) redirect('/deals');
  const body = String(form.get('body') ?? '').trim();
  if (!body) back(dealId, 'comment-empty');
  const page = Number(form.get('pageNumber') ?? '');
  const quote = String(form.get('quote') ?? '').trim();
  const result = await apiPost(`/v1/deals/${dealId}/my-bid/comments`, {
    documentId,
    body,
    ...(parentId ? { parentId } : {}),
    ...(Number.isInteger(page) && page > 0 ? { pageNumber: page } : {}),
    ...(quote ? { quote } : {}),
  });
  back(dealId, kind(result, 'ok-commented'));
}

const FILE_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
};

/** Attach a file to your bid: a marked-up agreement, a letter of intent. Scanned; seen by the seller and your firm only. */
export async function attachFile(dealId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) back(dealId, 'file-missing');
  const contentType = FILE_TYPES[(file.name.split('.').pop() ?? '').toLowerCase()];
  if (!contentType) back(dealId, 'file-type');
  const result = await apiPost(`/v1/deals/${dealId}/my-bid/files`, { fileName: file.name, contentType, contentBase64: Buffer.from(await file.arrayBuffer()).toString('base64') });
  back(dealId, result.kind === 'invalid' ? 'file-rejected' : kind(result, 'ok-attached'));
}

interface Handover {
  pact: { organizationId: string; dealId: string; company: string; companyType: string | null; currency: string };
  bid: { firmName: string; status: string };
  handover: { sellerLeadEmail: string | null } | null;
}

/**
 * The winner's own diligence (T-097, ADR 0015): start a buyer-led pact in
 * their own organization, linked to this sale, and invite the seller's lead
 * into it as the seller. The winner's analysis stays theirs — never inside the
 * seller's pact. The API accepts the link only from the sale's winner, once.
 */
export async function startLinkedPact(dealId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  // 1. Read what the winner may carry over, while still in the seller's pact.
  const sale = await apiGet<Handover>(`/v1/deals/${dealId}/my-bid`);
  if (sale.kind !== 'ok' || sale.data.bid.status !== 'WON') back(dealId, 'not-won');
  const { pact, bid, handover } = sale.data;
  // 2. Move into the winner's own organization.
  const me = await getMe();
  const home = me.kind === 'ok' ? me.data.organizations.find((organization) => organization.authMethod === 'EMAIL_CODE') : undefined;
  const token = await nativeSessionToken();
  if (!home || !token) back(dealId, 'no-home');
  const scoped = await authApi('/v1/auth/session/organization', { organizationId: home.id }, token);
  if (scoped.status !== 200) back(dealId, 'no-home');
  await storeNativeSession(scoped.data as IssuedSession);
  // 3. Start the linked pact there.
  const command: StartPactCommand = {
    name: `${pact.company} — our diligence`.slice(0, 200),
    baseCurrency: pact.currency,
    initiatedBy: 'BUYER',
    buyer: { name: bid.firmName, ownership: 'PRIVATE', ticker: null, exchange: null, website: null, companyType: null },
    seller: { name: pact.company, ownership: 'PRIVATE', ticker: null, exchange: null, website: null, companyType: (pact.companyType ?? 'OTHER') as StartPactCommand['seller']['companyType'] },
    askingPrice: null,
    linkedSale: { organizationId: pact.organizationId, dealId: pact.dealId },
  };
  const started = await dealsApi.startPact(command);
  if (started.kind === 'conflict') redirect('/deals?outcome=already-linked');
  if (started.kind !== 'ok') redirect('/deals?outcome=linked-failed');
  // 4. Invite the seller's lead into it, as the seller (best effort: they may sign in with company SSO and have no address on file).
  if (handover?.sellerLeadEmail) {
    await apiPost(`/v1/deals/${started.data.id}/invitations`, { email: handover.sellerLeadEmail, side: 'SELLER', role: 'TARGET_CONTRIBUTOR' }).catch(() => undefined);
  }
  redirect(`/deals/${started.data.id}/sources?started=1&linked=1`);
}
