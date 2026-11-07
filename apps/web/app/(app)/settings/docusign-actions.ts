'use server';

import { redirect } from 'next/navigation';
import { apiSend } from '../deals/_lib/api';

/** Start connecting the organization's own DocuSign account (T-107): off to DocuSign's sign-in. */
export async function connectDocuSign(): Promise<void> {
  const result = await apiSend<{ url: string }>('POST', '/v1/organization/docusign/start', {});
  if (result.kind !== 'ok' || !result.data.url.startsWith('https://account')) redirect('/settings?outcome=docusign-unavailable#docusign');
  redirect(result.data.url);
}

export async function disconnectDocuSign(): Promise<void> {
  const result = await apiSend('DELETE', '/v1/organization/docusign', {});
  redirect(`/settings?outcome=${result.kind === 'ok' ? 'docusign-disconnected' : result.kind}#docusign`);
}
