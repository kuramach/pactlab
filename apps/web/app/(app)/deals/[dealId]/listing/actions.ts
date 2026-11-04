'use server';

import { declineListingInterestSchema, saveListingSchema } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost, apiSend } from '../../_lib/api';

const uuid = z.uuid();

function back(dealId: string, outcome: string): never {
  redirect(`/deals/${dealId}/listing?outcome=${encodeURIComponent(outcome)}`);
}

const kind = (result: { kind: string }, ok: string) => (result.kind === 'ok' ? ok : ['conflict', 'invalid', 'forbidden'].includes(result.kind) ? result.kind : 'error');
const text = (form: FormData, name: string) => {
  const value = String(form.get(name) ?? '').trim();
  return value === '' ? null : value;
};

/** Save the teaser. Everything in it becomes public when the page is published. */
export async function saveListing(dealId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const parsed = saveListingSchema.safeParse({
    visibility: form.get('visibility') === 'NAMED' ? 'NAMED' : 'ANONYMOUS',
    codename: text(form, 'codename') ?? '',
    publicName: text(form, 'publicName'),
    headline: text(form, 'headline') ?? '',
    sector: text(form, 'sector'),
    region: text(form, 'region'),
    sizeBand: text(form, 'sizeBand'),
    askingLow: text(form, 'askingLow')?.replaceAll(',', '') ?? null,
    askingHigh: text(form, 'askingHigh')?.replaceAll(',', '') ?? null,
    askingCurrency: text(form, 'askingLow') ? (text(form, 'askingCurrency')?.toUpperCase() ?? null) : null,
    summary: text(form, 'summary') ?? '',
    highlights: String(form.get('highlights') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    indexable: form.get('indexable') === 'on',
  });
  if (!parsed.success) back(dealId, parsed.error.issues.some((issue) => issue.path[0] === 'publicName') ? 'name-missing' : 'invalid');
  back(dealId, kind(await apiSend('PUT', `/v1/deals/${dealId}/listing`, parsed.data), 'ok-saved'));
}

export async function setListingStatus(dealId: string, status: 'PUBLISHED' | 'DRAFT' | 'CLOSED'): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  back(dealId, kind(await apiSend('PUT', `/v1/deals/${dealId}/listing/status`, { status }), `ok-${status.toLowerCase()}`));
}

export async function approveInterest(dealId: string, interestId: string): Promise<void> {
  if (![dealId, interestId].every((id) => uuid.safeParse(id).success)) redirect('/deals');
  const result = await apiPost(`/v1/deals/${dealId}/listing/interests/${interestId}/approve`, {});
  back(dealId, result.kind === 'invalid' && result.code === 'PROCESS_CLOSED' ? 'process-closed' : kind(result, 'ok-approved'));
}

export async function declineInterest(dealId: string, interestId: string, form: FormData): Promise<void> {
  if (![dealId, interestId].every((id) => uuid.safeParse(id).success)) redirect('/deals');
  const parsed = declineListingInterestSchema.safeParse({ note: form.get('note') });
  if (!parsed.success) back(dealId, 'invalid');
  back(dealId, kind(await apiPost(`/v1/deals/${dealId}/listing/interests/${interestId}/decline`, parsed.data), 'ok-declined'));
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Upload one or more pictures; each is checked and stripped of metadata by the API. */
export async function addImages(dealId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const files = form.getAll('images').filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0) back(dealId, 'no-file');
  const caption = text(form, 'caption');
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) back(dealId, 'image-too-large');
    const result = await apiPost(`/v1/deals/${dealId}/listing/media/images`, { contentBase64: Buffer.from(await file.arrayBuffer()).toString('base64'), caption: files.length === 1 ? caption : null });
    if (result.kind !== 'ok') back(dealId, result.kind === 'conflict' ? 'too-many-images' : result.kind === 'invalid' ? 'not-an-image' : kind(result, 'ok-media'));
  }
  back(dealId, 'ok-media');
}

export async function addVideo(dealId: string, form: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const result = await apiPost(`/v1/deals/${dealId}/listing/media/videos`, { url: text(form, 'url') ?? '', caption: text(form, 'caption') });
  back(dealId, result.kind === 'conflict' ? 'too-many-videos' : result.kind === 'invalid' ? 'bad-video-link' : kind(result, 'ok-media'));
}

export async function captionMedia(dealId: string, mediaId: string, form: FormData): Promise<void> {
  if (![dealId, mediaId].every((id) => uuid.safeParse(id).success)) redirect('/deals');
  back(dealId, kind(await apiSend('PUT', `/v1/deals/${dealId}/listing/media/${mediaId}`, { caption: text(form, 'caption') }), 'ok-media'));
}

/** Move one item up or down: the whole order is sent, as the API expects. */
export async function moveMedia(dealId: string, ids: string[], index: number, direction: -1 | 1): Promise<void> {
  if (![dealId, ...ids].every((id) => uuid.safeParse(id).success)) redirect('/deals');
  const target = index + direction;
  if (target < 0 || target >= ids.length) back(dealId, 'ok-media');
  const order = [...ids];
  [order[index], order[target]] = [order[target] as string, order[index] as string];
  back(dealId, kind(await apiSend('PUT', `/v1/deals/${dealId}/listing/media/order`, { ids: order }), 'ok-media'));
}

export async function removeMedia(dealId: string, mediaId: string): Promise<void> {
  if (![dealId, mediaId].every((id) => uuid.safeParse(id).success)) redirect('/deals');
  back(dealId, kind(await apiSend('DELETE', `/v1/deals/${dealId}/listing/media/${mediaId}`, {}), 'ok-media'));
}
