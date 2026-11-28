'use server';

import { alertChannelsSchema, pushSubscriptionSchema } from '@pactlab/contracts';
import { ALERT_CHANNELS } from '@pactlab/domain';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { deviceLabel } from '../../../../lib/device-label';
import { apiSend } from '../../deals/_lib/api';

const PAGE = '/settings/notifications';

/** Urgent alerts (T-146): the channels left ticked are on; every other channel is turned off. */
export async function saveAlertChannels(formData: FormData): Promise<void> {
  const on = new Set(formData.getAll('channel').map(String));
  const parsed = alertChannelsSchema.safeParse({ off: ALERT_CHANNELS.filter((channel) => !on.has(channel)) });
  const result = parsed.success ? await apiSend('PUT', '/v1/notification-settings/channels', parsed.data) : null;
  revalidatePath(PAGE);
  redirect(`${PAGE}?alerts=${result?.kind === 'ok' ? 'saved' : 'invalid'}#alerts`);
}

/**
 * This browser's Push API subscription, as `PushSubscription.toJSON()` gives it. The device label comes
 * from the user agent here, on the server; the raw user agent is never sent on or stored.
 */
export async function subscribeThisDevice(subscription: { endpoint?: unknown; keys?: unknown }): Promise<{ ok: boolean; code?: string }> {
  const agent = (await headers()).get('user-agent');
  const parsed = pushSubscriptionSchema.safeParse({ endpoint: subscription.endpoint, keys: subscription.keys, label: deviceLabel(agent) ?? 'This device' });
  if (!parsed.success) return { ok: false };
  const result = await apiSend('POST', '/v1/me/push-subscriptions', parsed.data);
  revalidatePath(PAGE);
  return result.kind === 'ok' ? { ok: true } : { ok: false, ...(result.kind === 'invalid' && result.code ? { code: result.code } : {}) };
}

export async function testDevice(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return;
  const result = await apiSend<{ sent: boolean; expired: boolean }>('POST', `/v1/me/push-subscriptions/${encodeURIComponent(id)}/test`, {});
  revalidatePath(PAGE);
  redirect(`${PAGE}?device=${result.kind === 'ok' ? (result.data.sent ? 'tested' : result.data.expired ? 'expired' : 'failed') : 'failed'}#alerts`);
}

export async function removeDevice(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return;
  const result = await apiSend('DELETE', `/v1/me/push-subscriptions/${encodeURIComponent(id)}`, {});
  revalidatePath(PAGE);
  redirect(`${PAGE}?device=${result.kind === 'ok' ? 'removed' : 'failed'}#alerts`);
}
