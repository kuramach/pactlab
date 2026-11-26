'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../deals/_lib/api';

/** Only links back into a pact, as the API stores them. */
const pactLink = /^\/deals\/[0-9a-f-]{36}\/[a-z-]+(\/[0-9a-f-]{36})?$/;

/** Open an item (T-145): mark it read, then go to the exact place in the pact. */
export async function openNotification(id: string, link: string): Promise<void> {
  if (!z.uuid().safeParse(id).success || !pactLink.test(link)) return;
  await apiSend('POST', `/v1/notifications/${encodeURIComponent(id)}/read`, {});
  redirect(link);
}

export async function markNotificationRead(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return;
  await apiSend('POST', `/v1/notifications/${encodeURIComponent(id)}/read`, {});
  revalidatePath('/notifications');
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiSend('POST', '/v1/notifications/read-all', {});
  revalidatePath('/notifications');
}
