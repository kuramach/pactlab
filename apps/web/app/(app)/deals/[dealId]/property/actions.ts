'use server';

import { PROFILE_FIELD_KEYS } from '@pactlab/domain';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';

const uuid = z.uuid();
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/property?outcome=${encodeURIComponent(outcome)}`);
const CODES: Record<string, string> = {
  PROPERTY_ADDRESS_NEEDED: 'address-needed',
  METADATA_US_ONLY: 'us-only',
  NO_PUBLIC_RECORD: 'no-record',
  PROFILE_NOT_STARTED: 'not-started',
  ABSENCE_IS_NOT_A_VALUE: 'absence',
  PROPERTY_RECORD_OFF: 'record-off',
  PROPERTY_RECORD_RATE_LIMITED: 'busy',
  PROPERTY_RECORD_KEY_REFUSED: 'key',
  PROPERTY_RECORD_UNAVAILABLE: 'unavailable',
  PROPERTY_PHOTOS_OFF: 'photos-off',
  PROPERTY_PHOTOS_RATE_LIMITED: 'busy',
  PROPERTY_PHOTOS_KEY_REFUSED: 'key',
  PROPERTY_PHOTOS_UNAVAILABLE: 'unavailable',
};
const failure = (result: { kind: string; code?: string }) => (result.kind === 'invalid' || result.kind === 'unavailable' ? (CODES[result.code ?? ''] ?? result.kind) : result.kind);

/** Fill the profile from the address (US only): the record is proposed for review, nothing is accepted. */
export async function populateProfile(dealId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const address = String(form.get('address') ?? '').trim();
  const result = await apiSend('POST', `/v1/deals/${dealId}/property-profile/populate`, address ? { address } : {});
  back(dealId, result.kind === 'ok' ? 'ok-populated' : failure(result));
}

/** Accept the kept (and edited) values; the checked rows only, each with the value shown in its box. */
export async function acceptProfile(dealId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const values = PROFILE_FIELD_KEYS.flatMap((key) => {
    const value = String(form.get(`value:${key}`) ?? '').trim();
    return form.get(`keep:${key}`) === 'on' && value ? [{ key, value }] : [];
  });
  if (values.length === 0) back(dealId, 'nothing-kept');
  const result = await apiSend('POST', `/v1/deals/${dealId}/property-profile/accept`, { values });
  back(dealId, result.kind === 'ok' ? 'ok-accepted' : failure(result));
}

/** Compare the accepted values with the imported rent roll; a contradiction is raised as a claim. */
export async function checkProfile(dealId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const result = await apiSend<{ claims: number }>('POST', `/v1/deals/${dealId}/property-profile/check`, {});
  back(dealId, result.kind === 'ok' ? `ok-checked-${result.data.claims}` : failure(result));
}

/** Find the Street View exterior and Places photos for the address. */
export async function findPhotos(dealId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const result = await apiSend('POST', `/v1/deals/${dealId}/property-profile/photos`, {});
  back(dealId, result.kind === 'ok' ? 'ok-photos' : failure(result));
}
