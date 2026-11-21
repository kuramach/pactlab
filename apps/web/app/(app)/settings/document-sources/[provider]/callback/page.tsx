import { notFound, redirect } from 'next/navigation';
import { apiSend } from '../../../../deals/_lib/api';

// Per-user: completes the admin's Google Drive or OneDrive sign-in.
export const dynamic = 'force-dynamic';

/**
 * Google or Microsoft sends the organization admin back here with a one-time code (T-147). The API checks
 * the signed state, exchanges the code and keeps the refresh token in the credential store; this page only
 * relays and returns to Settings.
 */
export default async function DocumentSourceCallbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { provider } = await params;
  if (provider !== 'google-drive' && provider !== 'onedrive') notFound();
  const query = await searchParams;
  const code = typeof query['code'] === 'string' ? query['code'] : '';
  const state = typeof query['state'] === 'string' ? query['state'] : '';
  if (!code || !state) redirect('/settings?outcome=document-source-cancelled#document-sources');
  const result = await apiSend('POST', `/v1/organization/document-connections/${provider}/callback`, { code, state });
  redirect(`/settings?outcome=${result.kind === 'ok' ? 'document-source-connected' : 'document-source-failed'}#document-sources`);
}
