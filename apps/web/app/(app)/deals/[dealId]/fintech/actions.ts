'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost } from '../../_lib/api';

const uuid = z.uuid();

/** The fintech checks are the pack's rules: run them into Findings, then come back to the Payments page. */
export async function runChecks(dealId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const result = await apiPost<{ created: number }>(`/v1/deals/${dealId}/findings/pack-rules/run`, {});
  redirect(`/deals/${dealId}/fintech?outcome=${encodeURIComponent(result.kind === 'ok' ? `ok-checks-${result.data.created}` : result.kind)}`);
}
