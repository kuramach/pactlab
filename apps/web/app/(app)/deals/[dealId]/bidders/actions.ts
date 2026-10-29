'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost, apiSend } from '../../_lib/api';

const uuid = z.uuid();

function back(dealId: string, outcome: string): never {
  redirect(`/deals/${dealId}/bidders?outcome=${encodeURIComponent(outcome)}`);
}

const kind = (result: { kind: string }, ok: string) => (result.kind === 'ok' ? ok : result.kind === 'conflict' ? 'conflict' : result.kind === 'invalid' ? 'invalid' : result.kind === 'forbidden' ? 'forbidden' : 'error');

/** Save the shared view, NDA and deadline (T-097). */
export async function saveProcess(dealId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const text = (name: string) => {
    const value = String(form.get(name) ?? '').trim();
    return value === '' ? null : value;
  };
  const deadline = text('offerDeadline');
  const result = await apiSend('PUT', `/v1/deals/${dealId}/sale`, {
    sharedSummary: text('sharedSummary'),
    dataRoomUrl: text('dataRoomUrl'),
    ndaText: text('ndaText'),
    // datetime-local is the seller's local time; the browser sends it as entered, read here as UTC.
    offerDeadline: deadline ? new Date(`${deadline}:00Z`).toISOString() : null,
  });
  back(dealId, kind(result, 'ok-saved'));
}

export async function addBidder(dealId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const firmName = String(form.get('firmName') ?? '').trim();
  if (!firmName) back(dealId, 'firm-missing');
  const result = await apiPost(`/v1/deals/${dealId}/bids`, { firmName });
  back(dealId, kind(result, 'ok-bidder-added'));
}

export async function inviteBidder(dealId: string, bidId: string, form: FormData): Promise<void> {
  if (![dealId, bidId].every((id) => uuid.safeParse(id).success)) redirect('/deals');
  const email = String(form.get('email') ?? '').trim();
  const result = await apiPost(`/v1/deals/${dealId}/bids/${bidId}/invitations`, { email });
  back(dealId, result.kind === 'ok' ? 'ok-invited' : result.kind === 'conflict' ? 'already-invited' : kind(result, 'ok-invited'));
}

export async function bidAction(dealId: string, bidId: string, action: 'shortlist' | 'decline' | 'award' | 'round-model'): Promise<void> {
  if (![dealId, bidId].every((id) => uuid.safeParse(id).success)) redirect('/deals');
  const result = await apiPost(`/v1/deals/${dealId}/bids/${bidId}/${action}`, {});
  back(dealId, kind(result, `ok-${action}`));
}

export async function nextRound(dealId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const result = await apiPost(`/v1/deals/${dealId}/sale/next-round`, {});
  back(dealId, kind(result, 'ok-next-round'));
}

export async function answerQuestion(dealId: string, questionId: string, form: FormData): Promise<void> {
  if (![dealId, questionId].every((id) => uuid.safeParse(id).success)) redirect('/deals');
  const answer = String(form.get('answer') ?? '').trim();
  const scope = form.get('scope') === 'ALL' ? 'ALL' : 'PRIVATE';
  if (!answer) back(dealId, 'answer-missing');
  const result = await apiPost(`/v1/deals/${dealId}/bid-questions/${questionId}/answer`, { answer, scope });
  back(dealId, kind(result, scope === 'ALL' ? 'ok-answered-all' : 'ok-answered'));
}

/** Reply privately in a bidder's thread on a document. */
export async function replyToComment(dealId: string, commentId: string, form: FormData): Promise<void> {
  if (![dealId, commentId].every((id) => uuid.safeParse(id).success)) redirect('/deals');
  const body = String(form.get('body') ?? '').trim();
  if (!body) back(dealId, 'answer-missing');
  back(dealId, kind(await apiPost(`/v1/deals/${dealId}/bid-comments/${commentId}/replies`, { body }), 'ok-replied'));
}
