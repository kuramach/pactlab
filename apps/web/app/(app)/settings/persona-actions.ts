'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../deals/_lib/api';

const persona = z.enum(['QUALITY_COMPOUNDER', 'VALUE_INVESTOR', 'GRAVE_DANCER']);

/** The organization's default buyer persona (T-105); owners and admins only, the API re-checks. */
export async function setDefaultPersona(formData: FormData): Promise<void> {
  const value = formData.get('persona');
  const parsed = value === '' ? { success: true as const, data: null } : persona.safeParse(value);
  if (!parsed.success) redirect('/settings?outcome=persona-invalid#deal-style');
  const result = await apiSend('PUT', '/v1/organization/persona', { persona: parsed.data });
  redirect(`/settings?outcome=${result.kind === 'ok' ? 'persona-saved' : result.kind}#deal-style`);
}
