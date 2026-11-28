'use server';

import type { SupportChatHandoff, SupportChatHandoffView, SupportChatMessage, SupportChatReplyView } from '@pactlab/contracts';
import { headers } from 'next/headers';
import { apiPost } from '../../(app)/deals/_lib/api';
import { publicEnv } from '../../../lib/env';

export type HelpAsk = Omit<SupportChatMessage, 'history'> & { history: SupportChatMessage['history'] };
export type HelpAskResult = { kind: 'ok'; reply: SupportChatReplyView } | { kind: 'error' };
/** `declinedBefore`: the same ask was decided against earlier (T-176); `reason` is the team's own words, when they gave one. */
export type HelpHandoffResult = { kind: 'sent'; declinedBefore?: { reason: string | null } } | { kind: 'email-required' } | { kind: 'unavailable' } | { kind: 'limited' } | { kind: 'error' };

/** The public site's chat: signed out; the API limits it per conversation and per the visitor's address. */
async function publicPost<T>(path: string, body: unknown): Promise<{ status: number; data: T | null }> {
  const clientIp = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim();
  try {
    const response = await fetch(new URL(path, publicEnv().NEXT_PUBLIC_API_ORIGIN), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(clientIp ? { 'x-pactlab-client-ip': clientIp } : {}) },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const data = response.ok ? ((await response.json()) as T) : ((await response.json().catch(() => null)) as T | null);
    return { status: response.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

function sent(view: SupportChatHandoffView | null): HelpHandoffResult {
  return view?.earlierDecision ? { kind: 'sent', declinedBefore: { reason: view.earlierDecision.reason } } : { kind: 'sent' };
}

function handoffResult(status: number, data: (SupportChatHandoffView & { code?: string }) | null): HelpHandoffResult {
  const code = data?.code;
  if (status === 200) return sent(data);
  // A request the spam screen refused is not an outage: say it failed rather than "unavailable".
  if (status === 422 && code === 'REQUEST_REJECTED') return { kind: 'error' };
  if (status === 429) return { kind: 'limited' };
  if (status === 422 && code === 'EMAIL_REQUIRED') return { kind: 'email-required' };
  if (status === 422) return { kind: 'unavailable' };
  return { kind: 'error' };
}

export async function askHelpOnSite(message: HelpAsk): Promise<HelpAskResult> {
  const result = await publicPost<SupportChatReplyView>('/v1/public/support-chat/messages', message);
  return result.status === 200 && result.data ? { kind: 'ok', reply: result.data } : { kind: 'error' };
}

export async function handOffHelpOnSite(handoff: SupportChatHandoff): Promise<HelpHandoffResult> {
  const result = await publicPost<SupportChatHandoffView & { code?: string }>('/v1/public/support-chat/handoff', handoff);
  return handoffResult(result.status, result.data);
}

export async function askHelpInApp(message: HelpAsk): Promise<HelpAskResult> {
  const result = await apiPost<SupportChatReplyView>('/v1/support-chat/messages', message);
  return result.kind === 'ok' ? { kind: 'ok', reply: result.data } : { kind: 'error' };
}

export async function handOffHelpInApp(handoff: SupportChatHandoff): Promise<HelpHandoffResult> {
  const result = await apiPost<SupportChatHandoffView>('/v1/support-chat/handoff', handoff);
  if (result.kind === 'ok') return sent(result.data);
  if (result.kind === 'invalid') return result.code === 'HANDOFF_UNAVAILABLE' ? { kind: 'unavailable' } : { kind: 'error' };
  return { kind: 'error' };
}
