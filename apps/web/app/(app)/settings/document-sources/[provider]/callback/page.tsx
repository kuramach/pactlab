import { notFound, redirect } from 'next/navigation';
import { apiSend } from '../../../../deals/_lib/api';

// Per-user: completes the admin's Google Drive or OneDrive sign-in.
export const dynamic = 'force-dynamic';

/**
 * Google or Microsoft sends the person back here with a one-time code (T-147): an organization admin from
 * Settings, or anyone connecting a folder from a pact. The API checks the signed state, exchanges the code
 * and keeps the refresh token in the credential store; this page only relays and returns where they started.
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
  // One callback for both sign-ins: the organization's (back to Settings) or a person's for a pact's folder (back to the pact).
  const result = await apiSend<{ kind: 'org' } | { kind: 'pact'; dealId: string; sourceId: string }>('POST', `/v1/document-sign-ins/${provider}/callback`, { code, state });
  if (result.kind === 'ok' && result.data.kind === 'pact') redirect(`/deals/${result.data.dealId}/documents?source=${result.data.sourceId}#data-room`);
  redirect(`/settings?outcome=${result.kind === 'ok' ? 'document-source-connected' : 'document-source-failed'}#document-sources`);
}
