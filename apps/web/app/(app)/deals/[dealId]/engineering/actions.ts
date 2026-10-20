'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';

const input = z.strictObject({ enabled: z.enum(['true', 'false']).transform((value) => value === 'true'), basis: z.string().trim().min(10).max(1000) });

/** Show or hide contributor names on this deal. Only the deal lead may; the basis is recorded and audited. */
export async function setPeopleAccess(dealId: string, formData: FormData): Promise<void> {
  if (!z.uuid().safeParse(dealId).success) redirect('/deals');
  const parsed = input.safeParse({ enabled: formData.get('enabled'), basis: formData.get('basis') });
  if (!parsed.success) redirect(`/deals/${dealId}/engineering?outcome=basis`);
  const result = await apiSend('POST', `/v1/deals/${dealId}/people-access`, parsed.data);
  redirect(`/deals/${dealId}/engineering?outcome=${result.kind === 'ok' ? (parsed.data.enabled ? 'ok-names-on' : 'ok-names-off') : result.kind}`);
}
