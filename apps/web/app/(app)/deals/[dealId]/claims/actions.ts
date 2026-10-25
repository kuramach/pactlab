'use server';

import { createClaimSchema, updateClaimSchema } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost, apiSend } from '../../_lib/api';

const uuid = z.uuid();
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/claims?outcome=${outcome}`);

export async function createClaim(dealId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const parsed = createClaimSchema.safeParse({ statement: formData.get('statement'), source: formData.get('source') });
  if (!parsed.success) return back(dealId, 'invalid-statement');
  const result = await apiPost(`/v1/deals/${dealId}/claims`, parsed.data);
  back(dealId, result.kind === 'ok' ? 'ok-created' : result.kind);
}

/** Verify or contradict a claim against evidence, linking the findings it produced. */
export async function updateClaim(dealId: string, claimId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(claimId).success) redirect('/deals');
  const parsed = updateClaimSchema.safeParse({
    expectedVersion: formData.get('expectedVersion'),
    status: formData.get('status'),
    rationale: formData.get('rationale'),
    findingIds: formData.getAll('findingIds').map(String),
    evidenceItemIds: [],
  });
  if (!parsed.success) return back(dealId, 'invalid-claim');
  const result = await apiSend('PUT', `/v1/deals/${dealId}/claims/${claimId}`, parsed.data);
  back(dealId, result.kind === 'ok' ? 'ok-updated' : result.kind === 'invalid' && result.code ? `invalid-${result.code}` : result.kind);
}
