'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiSend } from '../deals/_lib/api';

/** The organization's investment committee (T-118): who is on it, and whether signing waits for it. */
export async function saveIcSettings(formData: FormData): Promise<void> {
  await apiSend('PUT', '/v1/organization/ic', { required: formData.get('required') === 'on', clearsConditions: formData.get('clearsConditions') === 'on' });
  revalidatePath('/settings');
}

export async function setIcMember(userId: string, member: boolean): Promise<void> {
  if (!z.uuid().safeParse(userId).success) return;
  await apiSend('PUT', `/v1/organization/ic/members/${userId}`, { member });
  revalidatePath('/settings');
}
