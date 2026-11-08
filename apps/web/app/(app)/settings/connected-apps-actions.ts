'use server';

import { revalidatePath } from 'next/cache';
import { apiSend } from '../deals/_lib/api';

/** Disconnect an AI app (T-084): its tokens stop working at once. */
export async function disconnectApp(grantId: string): Promise<void> {
  await apiSend('DELETE', `/v1/me/connected-apps/${encodeURIComponent(grantId)}`, {});
  revalidatePath('/settings');
}
