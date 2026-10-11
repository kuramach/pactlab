'use server';

import { comparableInputSchema } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../deals/_lib/api';

const FIELDS = [
  'kind',
  'name',
  'targetName',
  'acquirerName',
  'announcedOn',
  'companyType',
  'region',
  'enterpriseValue',
  'arr',
  'currency',
  'arrGrowth',
  'nrr',
  'grr',
  'sourceCitation',
  'sourceUrl',
] as const;

const back = (outcome: string): never => redirect(`/comparables?outcome=${outcome}`);

/** Record a comparable entered by a person. The API sets its origin and requires its source. */
export async function addComparable(formData: FormData): Promise<void> {
  const raw = Object.fromEntries(FIELDS.map((field) => [field, formData.get(field) ?? '']));
  const parsed = comparableInputSchema.safeParse(raw);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? '');
    back(`invalid-${FIELDS.includes(field as (typeof FIELDS)[number]) ? field : 'form'}`);
  }
  const result = await apiSend('POST', '/v1/comparables', parsed.data);
  back(result.kind === 'ok' ? 'ok-added' : result.kind);
}

/** Retire a comparable: it stays on record but no benchmark uses it. */
export async function retireComparable(comparableId: string): Promise<void> {
  if (!z.uuid().safeParse(comparableId).success) back('not-found');
  const result = await apiSend('POST', `/v1/comparables/${comparableId}/retire`, {});
  back(result.kind === 'ok' ? 'ok-retired' : result.kind);
}
