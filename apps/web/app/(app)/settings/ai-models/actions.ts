'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../deals/_lib/api';

const KEYS = ['fast', 'balanced', 'deep_review', 'contract_scrub', 'extraction', 'classification', 'document_qa', 'vision', 'import_mapping'] as const;

/** An owner or admin routes one job (or Claude role) to an approved model, or back to Pactlab's default (blank). */
export async function setOrganizationRoute(key: string, formData: FormData): Promise<void> {
  const value = String(formData.get('modelId') ?? '');
  if (!KEYS.includes(key as (typeof KEYS)[number]) || (value !== '' && !z.uuid().safeParse(value).success)) redirect('/settings/ai-models?outcome=invalid');
  const result = await apiSend('PUT', `/v1/ai/routing/${key}`, { modelId: value === '' ? null : value });
  revalidatePath('/settings/ai-models');
  const code = result.kind === 'ok' ? 'ok' : result.kind === 'invalid' && result.code ? result.code : result.kind;
  redirect(`/settings/ai-models?outcome=${encodeURIComponent(code)}`);
}
