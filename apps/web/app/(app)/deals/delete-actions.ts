'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiSend } from './_lib/api';

export type DeleteDealResult = { kind: 'ok'; keptOnLegalHold: number } | { kind: 'error'; message: string };

/** Delete a deal (deal lead only). The API checks the role and the typed name again. */
export async function deleteDeal(dealId: string, confirmName: string): Promise<DeleteDealResult> {
  if (!z.uuid().safeParse(dealId).success) return { kind: 'error', message: 'Unknown deal.' };
  const result = await apiSend<{ keptOnLegalHold: number }>('DELETE', `/v1/deals/${dealId}`, { confirmName });
  if (result.kind === 'ok') {
    revalidatePath('/deals');
    return { kind: 'ok', keptOnLegalHold: result.data.keptOnLegalHold };
  }
  if (result.kind === 'invalid') return { kind: 'error', message: 'The name does not match. Type the deal name exactly as shown.' };
  if (result.kind === 'forbidden') return { kind: 'error', message: 'Only the deal lead can delete this deal.' };
  if (result.kind === 'unavailable') return { kind: 'error', message: 'Files could not be removed from storage, so nothing was deleted. Try again.' };
  return { kind: 'error', message: 'The deal was not deleted. Try again.' };
}
