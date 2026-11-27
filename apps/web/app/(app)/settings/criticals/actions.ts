'use server';

import type { CriticalStructure } from '@pactlab/domain';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { structureFrom } from '../../_lib/criticals/fields';
import { apiPost, apiSend } from '../../deals/_lib/api';

const uuid = z.uuid();
const back = (outcome: string): never => redirect(`/settings/criticals?outcome=${encodeURIComponent(outcome)}`);
const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const failed = (result: { kind: string; code?: string }) => (result.kind === 'invalid' && result.code === 'STRUCTURE_INVALID' ? 'structure-invalid' : result.kind);

/** Write an org critical in the organization's words; Pactlab proposes the structure for a person to confirm. */
export async function createStandard(form: FormData): Promise<void> {
  const words = text(form, 'words');
  const companyType = text(form, 'companyType') || 'ALL';
  const result = await apiPost<{ key: string }>('/v1/criticals', { companyType, words });
  back(result.kind === 'ok' ? 'ok-proposed' : failed(result));
}

/** Confirm the structure (as proposed, or corrected): only now does the critical evaluate on pacts. */
export async function confirmStandard(criticalKey: string, version: number, form: FormData): Promise<void> {
  if (!uuid.safeParse(criticalKey).success) redirect('/settings/criticals');
  const structure: CriticalStructure | null = structureFrom(form);
  if (!structure) back('threshold');
  const result = await apiPost(`/v1/criticals/${criticalKey}/confirm`, { version, structure });
  back(result.kind === 'ok' ? 'ok-confirmed' : failed(result));
}

/** Edit the words: a new version, proposed again and inert until confirmed. Past ratings keep their version. */
export async function reviseStandard(criticalKey: string, version: number, form: FormData): Promise<void> {
  if (!uuid.safeParse(criticalKey).success) redirect('/settings/criticals');
  const result = await apiSend('PUT', `/v1/criticals/${criticalKey}`, { version, words: text(form, 'words') });
  back(result.kind === 'ok' ? 'ok-revised' : failed(result));
}

export async function retireStandard(criticalKey: string, version: number, form: FormData): Promise<void> {
  if (!uuid.safeParse(criticalKey).success) redirect('/settings/criticals');
  const result = await apiPost(`/v1/criticals/${criticalKey}/retire`, { version, reason: text(form, 'reason') || 'Retired from the library' });
  back(result.kind === 'ok' ? 'ok-retired' : failed(result));
}
