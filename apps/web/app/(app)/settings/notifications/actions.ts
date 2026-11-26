'use server';

import { notificationSettingsSchema, pactNotificationOverrideSchema } from '@pactlab/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../deals/_lib/api';

/** "HH:MM" from a time field → minutes after midnight; empty → null. */
function minutes(value: FormDataEntryValue | null): number | null {
  const match = typeof value === 'string' ? /^(\d{2}):(\d{2})$/.exec(value) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Settings → Notifications (T-145): the person's own settings. */
export async function saveNotificationSettings(formData: FormData): Promise<void> {
  const quietStart = minutes(formData.get('quietStart'));
  const quietEnd = minutes(formData.get('quietEnd'));
  const parsed = notificationSettingsSchema.safeParse({
    actNow: formData.get('actNow'),
    fyi: formData.get('fyi'),
    digest: formData.get('digest'),
    timeZone: formData.get('timeZone'),
    quietStart: quietStart !== null && quietEnd !== null ? quietStart : null,
    quietEnd: quietStart !== null && quietEnd !== null ? quietEnd : null,
    actNowThroughQuiet: formData.get('actNowThroughQuiet') === 'on',
  });
  if (!parsed.success) redirect('/settings/notifications?saved=invalid');
  const result = await apiSend('PUT', '/v1/notification-settings', parsed.data);
  revalidatePath('/settings/notifications');
  redirect(`/settings/notifications?saved=${result.kind === 'ok' ? 'yes' : 'invalid'}`);
}

const inherit = (value: FormDataEntryValue | null) => (value === 'INHERIT' || value === null ? null : value);

/** One pact's override: a mode per urgency, or follow the person's settings. */
export async function savePactNotificationSettings(dealId: string, formData: FormData): Promise<void> {
  if (!z.uuid().safeParse(dealId).success) return;
  const parsed = pactNotificationOverrideSchema.safeParse({ actNow: inherit(formData.get('actNow')), fyi: inherit(formData.get('fyi')) });
  if (!parsed.success) redirect(`/settings/notifications?deal=${dealId}&saved=invalid`);
  const result = await apiSend('PUT', `/v1/deals/${encodeURIComponent(dealId)}/notification-settings`, parsed.data);
  revalidatePath('/settings/notifications');
  redirect(`/settings/notifications?deal=${dealId}&saved=${result.kind === 'ok' ? 'yes' : 'invalid'}`);
}
