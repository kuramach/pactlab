'use server';

import { replyFeatureRequestSchema } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost } from '../../deals/_lib/api';

/** Answer the question the team asked about a request; it goes back to triage. */
export async function answerFeatureQuestion(proposalId: string, formData: FormData): Promise<void> {
  const parsed = replyFeatureRequestSchema.safeParse({ reply: formData.get('reply') });
  if (!parsed.success || !z.uuid().safeParse(proposalId).success) redirect('/settings/feature-requests?outcome=invalid');
  const result = await apiPost(`/v1/feature-requests/mine/${proposalId}/reply`, parsed.data);
  redirect(`/settings/feature-requests?outcome=${result.kind === 'ok' ? 'ok-reply' : 'failed'}`);
}
