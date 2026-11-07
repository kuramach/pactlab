import { redirect } from 'next/navigation';
import { apiSend } from '../../../deals/_lib/api';

// Per-user: completes the admin's DocuSign sign-in.
export const dynamic = 'force-dynamic';

/**
 * DocuSign sends the organization admin back here with a one-time code (T-107).
 * The API checks the signed state, exchanges the code and keeps the token in the
 * secret store; this page only relays and returns to Settings.
 */
export default async function DocuSignCallbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const code = typeof query['code'] === 'string' ? query['code'] : '';
  const state = typeof query['state'] === 'string' ? query['state'] : '';
  if (!code || !state) redirect('/settings?outcome=docusign-cancelled#docusign');
  const result = await apiSend('POST', '/v1/organization/docusign/callback', { code, state });
  redirect(`/settings?outcome=${result.kind === 'ok' ? 'docusign-connected' : 'docusign-failed'}#docusign`);
}
