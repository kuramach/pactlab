'use server';

import { screeningInputSchema, screeningVerdictSchema } from '@pactlab/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';

const uuid = z.uuid();
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/screening?outcome=${outcome}`);

/** Save the screening intake (screening-grade only; never findings or valuation). */
export async function saveScreening(dealId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const redFlags = String(formData.get('redFlags') ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const parsed = screeningInputSchema.safeParse({
    intakeNotes: formData.get('intakeNotes'),
    headlineRevenue: formData.get('headlineRevenue'),
    headlineCurrency: formData.get('headlineCurrency'),
    valueLow: formData.get('valueLow'),
    valueHigh: formData.get('valueHigh'),
    redFlags,
    expectedVersion: formData.get('expectedVersion'),
  });
  if (!parsed.success) return back(dealId, `invalid-${String(parsed.error.issues[0]?.path[0] ?? 'form')}`);
  const result = await apiSend('PUT', `/v1/deals/${dealId}/screening`, parsed.data);
  back(dealId, result.kind === 'ok' ? 'ok-saved' : result.kind);
}

/** Record the go / no-go verdict (deal lead). GO moves the pact into Diligence. */
export async function decideScreening(dealId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const parsed = screeningVerdictSchema.safeParse({ verdict: formData.get('verdict'), rationale: formData.get('rationale'), gaps: formData.get('gaps') });
  if (!parsed.success) return back(dealId, 'invalid-rationale');
  const result = await apiSend('POST', `/v1/deals/${dealId}/screening/verdict`, parsed.data);
  // A verdict can change the stage or archive the pact: refresh the deal header.
  if (result.kind === 'ok') revalidatePath(`/deals/${dealId}`, 'layout');
  if (result.kind === 'ok' && parsed.data.verdict === 'GO') redirect(`/deals/${dealId}/claims?outcome=ok-go`);
  back(dealId, result.kind === 'ok' ? `ok-${parsed.data.verdict.toLowerCase()}` : result.kind === 'invalid' && result.code === 'GAPS_REQUIRED' ? 'invalid-gaps' : result.kind);
}
