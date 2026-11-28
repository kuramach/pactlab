import { redirect } from 'next/navigation';
import { apiSend } from '../../deals/_lib/api';

/**
 * Slack or Microsoft sends the admin back here with a one-time code (T-181). The API checks the signed
 * state and finishes the install (Slack's bot token goes to the credential store); this page only
 * relays and returns to Settings, with the outcome and never an id.
 */
export async function finishChatInstall(provider: 'slack' | 'teams', searchParams: Promise<Record<string, string | string[] | undefined>>): Promise<never> {
  const query = await searchParams;
  const code = typeof query['code'] === 'string' ? query['code'] : '';
  const state = typeof query['state'] === 'string' ? query['state'] : '';
  if (!code || !state) redirect(`/settings?outcome=chat-${provider}-cancelled#chat-apps`);
  const result = await apiSend('POST', `/v1/organization/chat-apps/${provider}/callback`, { code, state });
  const outcome = result.kind === 'ok' ? 'installed' : 'code' in result && result.code === 'INSTALL_TAKEN' ? 'taken' : 'failed';
  redirect(`/settings?outcome=chat-${provider}-${outcome}#chat-apps`);
}
