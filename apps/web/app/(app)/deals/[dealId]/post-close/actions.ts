'use server';

import { updatePostCloseItemSchema } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';

const uuid = z.uuid();
const back = (dealId: string, outcome: string): never => redirect(`/deals/${dealId}/post-close?outcome=${outcome}`);

/** Work a post-close item: owner, date, cadence, done or lapsed. */
export async function updatePostCloseItem(dealId: string, itemId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(itemId).success) redirect('/deals');
  const parsed = updatePostCloseItemSchema.safeParse({
    expectedVersion: formData.get('expectedVersion'),
    status: formData.get('status'),
    ownerUserId: formData.get('ownerUserId'),
    dueDate: formData.get('dueDate'),
    cadence: formData.get('cadence'),
    note: formData.get('note'),
  });
  if (!parsed.success) return back(dealId, 'invalid');
  const result = await apiSend('PUT', `/v1/deals/${dealId}/post-close/${itemId}`, parsed.data);
  back(dealId, result.kind === 'ok' ? 'ok-updated' : result.kind);
}

/** Re-derive the registers from diligence output (adds only what is new). */
export async function refreshPostClose(dealId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const result = await apiSend<{ created: number }>('POST', `/v1/deals/${dealId}/post-close/generate`, {});
  back(dealId, result.kind === 'ok' ? `ok-refreshed-${result.data.created}` : result.kind);
}
