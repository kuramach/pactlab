'use server';

import type { PasskeyOptionsView, PasskeysView } from '@pactlab/contracts';
import { revalidatePath } from 'next/cache';
import { forgetPasskeyOffer } from '../../../lib/native-session';
import { apiSend } from '../deals/_lib/api';

/** What adding a passkey can come back with, in words the card shows. */
export type PasskeyStep = { kind: 'ok' } | { kind: 'reauth' } | { kind: 'failed' };

/** Registration options for this browser, or why not (T-108). */
export async function passkeyRegistrationOptions(): Promise<{ kind: 'ok'; started: PasskeyOptionsView } | Exclude<PasskeyStep, { kind: 'ok' }>> {
  const result = await apiSend<PasskeyOptionsView>('POST', '/v1/me/passkeys/options', {});
  if (result.kind === 'ok') return { kind: 'ok', started: result.data };
  return result.kind === 'invalid' && result.code === 'REAUTH_REQUIRED' ? { kind: 'reauth' } : { kind: 'failed' };
}

export async function savePasskey(challengeId: string, name: string, response: unknown): Promise<PasskeyStep> {
  const result = await apiSend<PasskeysView>('POST', '/v1/me/passkeys', { challengeId, name: name.trim().slice(0, 60) || 'Passkey', response });
  if (result.kind !== 'ok') return result.kind === 'invalid' && result.code === 'REAUTH_REQUIRED' ? { kind: 'reauth' } : { kind: 'failed' };
  await forgetPasskeyOffer();
  revalidatePath('/', 'layout');
  return { kind: 'ok' };
}

export async function removePasskey(passkeyId: string): Promise<void> {
  await apiSend('DELETE', `/v1/me/passkeys/${encodeURIComponent(passkeyId)}`, {});
  revalidatePath('/settings');
}

/** "Not now" on the one-time offer: remembered on the account, so it never comes back. */
export async function dismissPasskeyOffer(): Promise<void> {
  await apiSend('POST', '/v1/me/passkeys/offer/dismiss', {});
  await forgetPasskeyOffer();
  revalidatePath('/', 'layout');
}
