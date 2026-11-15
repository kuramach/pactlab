'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost } from '../../_lib/api';

const uuid = z.uuid();
const note = z.string().trim().max(2000);

/** Approve or reject a connected app's suggestion (T-084b). Approval runs the app's own service, as you. */
export async function decideSuggestion(dealId: string, proposalId: string, decision: 'APPROVE' | 'REJECT', formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(proposalId).success) redirect('/deals');
  const parsedNote = note.safeParse(formData.get('note') ?? '');
  if (!parsedNote.success) redirect(`/deals/${dealId}/suggestions?outcome=invalid-note`);
  const result = await apiPost<{ status: string }>(`/v1/deals/${dealId}/agent-proposals/${proposalId}/decision`, { decision, ...(parsedNote.data ? { note: parsedNote.data } : {}) });
  const outcome =
    result.kind === 'ok'
      ? result.data.status === 'FAILED'
        ? 'failed'
        : decision === 'APPROVE'
          ? 'ok-approved'
          : 'ok-rejected'
      : result.kind === 'invalid' && result.code === 'ALREADY_DECIDED'
        ? 'already-decided'
        : result.kind;
  redirect(`/deals/${dealId}/suggestions?outcome=${outcome}`);
}
