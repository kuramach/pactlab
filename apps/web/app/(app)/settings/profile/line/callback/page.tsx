import type { LineCallbackView } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { apiSend } from '../../../../deals/_lib/api';

// Per-user and one-time: never prerender.
export const dynamic = 'force-dynamic';

/**
 * LINE Login sends the person back here with a one-time code (T-182). The API checks the signed state, verifies
 * the ID token and asks LINE about the friendship; this page only relays and returns to Your profile with the
 * outcome, never the LINE user ID.
 */
export default async function LineCallbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const code = typeof query['code'] === 'string' ? query['code'] : '';
  const state = typeof query['state'] === 'string' ? query['state'] : '';
  if (!code || !state) redirect('/settings/profile?error=LINE_CANCELLED#line');
  const result = await apiSend<LineCallbackView>('POST', '/v1/me/contact/line/callback', { code, state });
  if (result.kind !== 'ok') redirect(`/settings/profile?error=${'code' in result && result.code ? result.code : 'LINE_LOGIN_FAILED'}#line`);
  redirect(`/settings/profile?done=${result.data.status === 'LINKED' ? 'line-connected' : 'line-add-friend'}#line`);
}
