'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiPost } from '../(app)/deals/_lib/api';

export type DemoShareState =
  | { kind: 'idle' }
  | { kind: 'shared'; slot: number; endsAt: string; buyerUrl: string; sellerUrl: string; sharedWith: string }
  | { kind: 'error'; message: string };

const shareSchema = z.strictObject({ sharedWith: z.string().trim().min(1).max(200), hours: z.coerce.number().pipe(z.union([z.literal(24), z.literal(72), z.literal(168)])) });

/** Lend a free demo (T-113). The two links come back this once; Pactlab keeps only their hashes. */
export async function shareDemo(_previous: DemoShareState, formData: FormData): Promise<DemoShareState> {
  const parsed = shareSchema.safeParse({ sharedWith: formData.get('sharedWith'), hours: formData.get('hours') });
  if (!parsed.success) return { kind: 'error', message: 'Say who the demo is for, and pick how long.' };
  const result = await apiPost<{ slot: number; endsAt: string; buyerUrl: string; sellerUrl: string }>('/v1/admin/demos', parsed.data);
  revalidatePath('/admin');
  if (result.kind === 'ok') return { kind: 'shared', ...result.data, sharedWith: parsed.data.sharedWith };
  if (result.kind === 'conflict') return { kind: 'error', message: 'All five demos are out or being reset. End one, or wait for a reset (up to 15 minutes).' };
  return { kind: 'error', message: 'The demo could not be shared. Try again.' };
}

const back = (outcome: string): never => redirect(`/admin?tab=demos&outcome=${outcome}`);

export async function endDemoShare(shareId: string): Promise<void> {
  if (!z.uuid().safeParse(shareId).success) back('invalid');
  const result = await apiPost(`/v1/admin/demos/shares/${shareId}/end`, {});
  revalidatePath('/admin');
  back(result.kind === 'ok' ? 'ok-demo-ended' : result.kind);
}

export async function resetDemoSlot(organizationId: string): Promise<void> {
  if (!z.uuid().safeParse(organizationId).success) back('invalid');
  const result = await apiPost(`/v1/admin/demos/slots/${organizationId}/reset`, {});
  revalidatePath('/admin');
  back(result.kind === 'ok' ? 'ok-demo-reset' : result.kind);
}
