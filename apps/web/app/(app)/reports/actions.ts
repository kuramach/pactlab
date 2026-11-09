'use server';

import { redirect } from 'next/navigation';
import { apiSend } from '../deals/_lib/api';

/** Start a report version (T-110); it appears in the history as Generating, then Ready. */
export async function generateReport(scope: 'EXECUTIVE' | 'PACT', dealId: string | null): Promise<void> {
  const result = await apiSend('POST', '/v1/reports', { scope, ...(dealId ? { dealId } : {}) });
  const back = new URLSearchParams({ outcome: result.kind === 'ok' ? 'ok-generating' : 'failed', ...(dealId ? { dealId } : {}) });
  redirect(`/reports?${back}`);
}

/** The pact picker's form. */
export async function generatePactReport(formData: FormData): Promise<void> {
  const dealId = String(formData.get('dealId') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(dealId)) redirect('/reports?outcome=pick-pact');
  await generateReport('PACT', dealId);
}
