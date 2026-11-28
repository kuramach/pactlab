'use server';

import { contactCodeSchema, contactEmailStartSchema, whatsappStartSchema, type LineLinkView, type TelegramLinkView } from '@pactlab/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend, type SendResult } from '../../deals/_lib/api';

const PROFILE = '/settings/profile';

/** Back to the profile with the outcome in the URL: never the address or number itself. */
function back(result: SendResult<unknown>, ok: string, step?: string): never {
  revalidatePath(PROFILE);
  const query = new URLSearchParams();
  if (result.kind === 'ok') query.set('done', ok);
  else query.set('error', 'code' in result && result.code ? result.code : result.kind === 'unavailable' ? 'UNAVAILABLE' : result.kind === 'invalid' ? 'INVALID' : 'ERROR');
  if (step && result.kind === 'ok') query.set('step', step);
  redirect(`${PROFILE}?${query.toString()}`);
}

/** "Your profile" (T-180): send a code to the address; the next step asks for it. */
export async function startEmail(formData: FormData): Promise<void> {
  const parsed = contactEmailStartSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) redirect(`${PROFILE}?error=INVALID_EMAIL`);
  back(await apiSend('POST', '/v1/me/contact/email', parsed.data), 'email-sent', 'email-code');
}

export async function confirmEmail(formData: FormData): Promise<void> {
  const parsed = contactCodeSchema.safeParse({ code: String(formData.get('code') ?? '').trim() });
  if (!parsed.success) redirect(`${PROFILE}?step=email-code&error=INVALID_CODE`);
  const result = await apiSend('POST', '/v1/me/contact/email/confirm', parsed.data);
  if (result.kind !== 'ok') redirect(`${PROFILE}?step=email-code&error=${'code' in result && result.code ? result.code : 'INVALID_CODE'}`);
  back(result, 'email-confirmed');
}

/** Connect Telegram: a single-use, 10-minute deep link into the bot. */
export async function connectTelegram(): Promise<void> {
  const result = await apiSend<TelegramLinkView>('POST', '/v1/me/contact/telegram', {});
  if (result.kind !== 'ok' || !/^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=[A-Za-z0-9_-]{1,64}$/.test(result.data.url)) back(result, 'telegram');
  redirect(result.data.url);
}

/** Connect LINE (T-182): LINE Login, which then offers the Pactlab account as a friend. */
export async function connectLine(): Promise<void> {
  const result = await apiSend<LineLinkView>('POST', '/v1/me/contact/line', {});
  if (result.kind !== 'ok' || !result.data.url.startsWith('https://access.line.me/oauth2/v2.1/authorize?')) back(result, 'line');
  redirect(result.data.url);
}

export async function startWhatsApp(formData: FormData): Promise<void> {
  const parsed = whatsappStartSchema.safeParse({ number: formData.get('number'), dial: formData.get('dial') || undefined, consent: formData.get('consent') === 'on' ? true : undefined });
  if (!parsed.success) redirect(`${PROFILE}?error=${formData.get('consent') === 'on' ? 'INVALID_NUMBER' : 'CONSENT_REQUIRED'}`);
  back(await apiSend('POST', '/v1/me/contact/whatsapp', parsed.data), 'whatsapp-sent', 'whatsapp-code');
}

export async function confirmWhatsApp(formData: FormData): Promise<void> {
  const parsed = contactCodeSchema.safeParse({ code: String(formData.get('code') ?? '').trim() });
  if (!parsed.success) redirect(`${PROFILE}?step=whatsapp-code&error=INVALID_CODE`);
  const result = await apiSend('POST', '/v1/me/contact/whatsapp/confirm', parsed.data);
  if (result.kind !== 'ok') redirect(`${PROFILE}?step=whatsapp-code&error=${'code' in result && result.code ? result.code : 'INVALID_CODE'}`);
  back(result, 'whatsapp-connected');
}

export async function testChannel(channelId: string): Promise<void> {
  if (!z.uuid().safeParse(channelId).success) return;
  back(await apiSend('POST', `/v1/me/contact/channels/${encodeURIComponent(channelId)}/test`, {}), 'test-sent');
}

export async function disconnectChannel(channelId: string): Promise<void> {
  if (!z.uuid().safeParse(channelId).success) return;
  back(await apiSend('DELETE', `/v1/me/contact/channels/${encodeURIComponent(channelId)}`, {}), 'disconnected');
}
