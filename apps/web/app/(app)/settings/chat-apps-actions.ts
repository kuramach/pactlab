'use server';

import { chatProviderSchema, type ChatInstallStartView } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { apiSend } from '../deals/_lib/api';

/** Only the provider's own sign-in pages: Slack's OAuth, or Microsoft's (and the fixtures outside production). */
const INSTALL_HOSTS = ['slack.com', 'login.microsoftonline.com', 'slack.fixture.test', 'login.fixture.test'];

/** Settings → Connected apps (T-181): an admin installs Pactlab into the company's Slack or Teams. */
export async function installChatApp(provider: string): Promise<void> {
  const parsed = chatProviderSchema.safeParse(provider);
  if (!parsed.success) return;
  const result = await apiSend<ChatInstallStartView>('POST', `/v1/organization/chat-apps/${parsed.data}/install`, {});
  if (result.kind !== 'ok') redirect(`/settings?outcome=chat-${parsed.data}-unavailable#chat-apps`);
  const url = new URL(result.data.url);
  if (url.protocol !== 'https:' || !INSTALL_HOSTS.includes(url.hostname)) redirect(`/settings?outcome=chat-${parsed.data}-unavailable#chat-apps`);
  redirect(url.toString());
}

export async function uninstallChatApp(provider: string): Promise<void> {
  const parsed = chatProviderSchema.safeParse(provider);
  if (!parsed.success) return;
  const result = await apiSend('DELETE', `/v1/organization/chat-apps/${parsed.data}`, {});
  redirect(`/settings?outcome=chat-${parsed.data}-${result.kind === 'ok' ? 'uninstalled' : 'failed'}#chat-apps`);
}
