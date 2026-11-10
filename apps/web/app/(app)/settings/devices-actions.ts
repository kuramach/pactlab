'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { SIGN_IN_PATH } from '../../../lib/auth-flow';
import { clearNativeSession } from '../../../lib/native-session';
import { apiSend } from '../deals/_lib/api';

/** Sign out one of your devices (T-112). Signing out this one ends the session here too. */
export async function signOutDevice(sessionId: string, current: boolean): Promise<void> {
  if (!z.uuid().safeParse(sessionId).success) return;
  await apiSend('DELETE', `/v1/me/sessions/${encodeURIComponent(sessionId)}`, {});
  if (current) {
    await clearNativeSession();
    redirect(SIGN_IN_PATH);
  }
  revalidatePath('/settings');
}

/** Sign out everywhere else: every other device, trusted or not. */
export async function signOutOtherDevices(): Promise<void> {
  await apiSend('POST', '/v1/me/sessions/revoke-others', {});
  revalidatePath('/settings');
}

const policySchema = z.coerce.number().pipe(z.union([z.literal(0), z.literal(24), z.literal(168), z.literal(720)]));

/** Organization admins: the longest trusted sign-in members may keep. Applies to open sessions at once. */
export async function setSessionPolicy(formData: FormData): Promise<void> {
  const parsed = policySchema.safeParse(formData.get('maxTrustedHours'));
  if (!parsed.success) return;
  await apiSend('PUT', '/v1/organization/session-policy', { maxTrustedHours: parsed.data });
  revalidatePath('/settings');
}
