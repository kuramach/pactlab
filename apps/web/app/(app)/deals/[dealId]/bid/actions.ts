'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost } from '../../_lib/api';

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
