'use server';

import { createOfferSchema, updateOfferSchema, ventureSettingsSchema } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';

const uuid = z.uuid();
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/raise?outcome=${outcome}`);
/** "12,000,000" → "12000000"; "10" (percent) → "0.1". Strings only; no floating point. */
const plain = (value: FormDataEntryValue | null) => String(value ?? '').trim().replaceAll(',', '');
function percentToFraction(value: FormDataEntryValue | null): string | null {
  const text = plain(value);
  if (!/^\d{1,2}(\.\d{1,4})?$/.test(text)) return null;
  const [whole = '0', fraction = ''] = text.split('.');
  const digits = whole.padStart(2, '0') + fraction;
  const result = `0.${digits}`.replace(/0+$/, '').replace(/\.$/, '');
  return result === '0' ? '0' : result;
}
const optional = (value: FormDataEntryValue | null) => (plain(value) === '' ? null : plain(value));

/** Save the round: type, currency, the ask, the raise and the pool target. */
export async function saveRound(dealId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const version = plain(formData.get('expectedVersion'));
  const parsed = ventureSettingsSchema.safeParse({
    expectedVersion: version ? Number(version) : null,
    roundType: formData.get('roundType'),
    currency: formData.get('currency'),
    targetPreMoney: plain(formData.get('targetPreMoney')),
    raiseAmount: plain(formData.get('raiseAmount')),
    poolTargetPct: percentToFraction(formData.get('poolTargetPct')),
    sector: optional(formData.get('sector')),
  });
  if (!parsed.success) return back(dealId, `invalid-${String(parsed.error.issues[0]?.path[0] ?? 'round')}`);
  const result = await apiSend('PUT', `/v1/deals/${dealId}/venture/settings`, parsed.data);
  back(dealId, result.kind === 'ok' ? 'ok-round' : result.kind);
}

const offerFields = (formData: FormData) => ({
  investorName: formData.get('investorName'),
  counterpartyType: formData.get('counterpartyType'),
  status: formData.get('status') ?? 'PROSPECT',
  preMoney: optional(formData.get('preMoney')),
  amount: optional(formData.get('amount')),
  poolTargetPct: optional(formData.get('poolTargetPct')) === null ? null : percentToFraction(formData.get('poolTargetPct')),
  liquidationMultiple: plain(formData.get('liquidationMultiple')) || '1',
  participating: formData.get('participating') === 'on',
  investorBoardSeats: optional(formData.get('investorBoardSeats')) === null ? null : Number(plain(formData.get('investorBoardSeats'))),
  proRata: formData.get('proRata') === 'on',
  mfn: formData.get('mfn') === 'on',
  receivedOn: optional(formData.get('receivedOn')),
});

/** Record an investor's bid. */
export async function addOffer(dealId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const parsed = createOfferSchema.safeParse(offerFields(formData));
  if (!parsed.success) return back(dealId, `invalid-offer-${String(parsed.error.issues[0]?.path[0] ?? 'form')}`);
  const result = await apiSend('POST', `/v1/deals/${dealId}/venture/offers`, parsed.data);
  back(dealId, result.kind === 'ok' ? 'ok-offer' : result.kind);
}

/** Move an offer to another status (term sheet, declined, signed), keeping its terms. */
export async function setOfferStatus(dealId: string, offer: Record<string, unknown>, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(offer['id']).success) redirect('/deals');
  const { id, version, ...fields } = offer;
  const parsed = updateOfferSchema.safeParse({ ...fields, expectedVersion: version, status: formData.get('status') });
  if (!parsed.success) return back(dealId, 'invalid-offer-status');
  const result = await apiSend('PUT', `/v1/deals/${dealId}/venture/offers/${String(id)}`, parsed.data);
  back(dealId, result.kind === 'ok' ? 'ok-offer-status' : result.kind);
}
