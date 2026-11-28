import type { LineCallbackView } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { apiSend } from '../../../../deals/_lib/api';

// Per-user: completes the person's own LINE Login.
export const dynamic = 'force-dynamic';

/**
 * LINE Login returns here with a one-time code (T-182). The API checks the state is this person's, exchanges
 * the code, verifies the ID token and reads whether they added the Pactlab account; this page only relays and
 * returns to the profile: connected, one more step (add the friend), or what went wrong. Never the LINE user id.
 */
export default async function LineCallbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const code = typeof query['code'] === 'string' ? query['code'] : '';
  const state = typeof query['state'] === 'string' ? query['state'] : '';
  if (!code || !state) redirect('/settings/profile?error=LINE_CANCELLED#line');
  const result = await apiSend<LineCallbackView>('POST', '/v1/me/contact/line/callback', { code, state });
  if (result.kind !== 'ok') redirect(`/settings/profile?error=${'code' in result && result.code ? result.code : 'LINE_LOGIN_FAILED'}#line`);
  redirect(result.data.status === 'CONNECTED' ? '/settings/profile?done=line-connected#line' : '/settings/profile?step=line-add-friend#line');
}
