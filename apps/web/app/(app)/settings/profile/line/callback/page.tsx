import { lineCallbackSchema, type LineCallbackView } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { apiSend } from '../../../../deals/_lib/api';

// Per-user: completes the person's own LINE Login.
export const dynamic = 'force-dynamic';

/**
 * LINE Login sends the person back here (T-182). The API checks the state is theirs, has LINE prove the
 * user id and says whether they are a friend yet; this page only relays and returns to the profile, with
 * the outcome and never an id. A cancelled login (`error`) carries no code.
 */
export default async function LineCallbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const parsed = lineCallbackSchema.safeParse({ code: query['code'], state: query['state'] });
  if (!parsed.success) redirect('/settings/profile?error=LINE_CANCELLED#line');
  const result = await apiSend<LineCallbackView>(
    'POST',
    '/v1/me/contact/line/callback',
    parsed.data,
  );
  if (result.kind !== 'ok')
    redirect(
      `/settings/profile?error=${'code' in result && result.code ? result.code : 'LINE_LOGIN_FAILED'}#line`,
    );
  redirect(
    `/settings/profile?done=${result.data.status === 'LINKED' ? 'line-connected' : 'line-add-friend'}#line`,
  );
}
