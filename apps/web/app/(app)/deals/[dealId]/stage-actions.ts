'use server';

import { DEAL_STAGES } from '@pactlab/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../_lib/api';

const input = z.strictObject({ dealId: z.uuid(), stage: z.enum(DEAL_STAGES) });

/** Move the pact along its pipeline. Closing opens Post-Close and generates its registers. */
export async function moveStage(dealId: string, formData: FormData): Promise<void> {
  const parsed = input.safeParse({ dealId, stage: formData.get('stage') });
  if (!parsed.success) redirect('/deals');
  const result = await apiSend('PATCH', `/v1/deals/${parsed.data.dealId}`, { stage: parsed.data.stage });
  // The deal header (layout) shows the phase: refresh it with the new stage.
  if (result.kind === 'ok') revalidatePath(`/deals/${parsed.data.dealId}`, 'layout');
  if (result.kind === 'ok' && parsed.data.stage === 'CLOSED') redirect(`/deals/${parsed.data.dealId}/post-close`);
  // Terms were negotiated on Pactlab: the pact closes two-sided, from the Closing tab (T-107).
  if (result.kind === 'conflict' && parsed.data.stage === 'CLOSED') redirect(`/deals/${parsed.data.dealId}/closing?outcome=close-here`);
  redirect(`/deals/${parsed.data.dealId}?outcome=${result.kind === 'ok' ? 'ok-stage' : result.kind === 'forbidden' ? 'stage-forbidden' : 'stage-error'}`);
}
