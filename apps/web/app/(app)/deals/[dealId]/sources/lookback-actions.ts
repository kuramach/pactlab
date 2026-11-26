'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';
import { readLookback } from '../../_lib/lookback';

/** Change how much history a GitHub or Jira source reads; the next sync pulls that window. */
export async function setLookback(dealId: string, connectionId: string, formData: FormData): Promise<void> {
  const lookbackMonths = readLookback(formData.get('lookbackMonths'));
  if (!z.uuid().safeParse(dealId).success || !z.uuid().safeParse(connectionId).success || lookbackMonths === null) redirect('/deals');
  await apiSend('PUT', `/v1/deals/${encodeURIComponent(dealId)}/connections/${encodeURIComponent(connectionId)}/lookback`, { lookbackMonths });
  redirect(`/deals/${dealId}/sources`);
}
