'use server';

import { redirect } from 'next/navigation';
import { apiSend } from '../deals/_lib/api';

/** Settings → Signing (T-136): which provider new envelopes go out with. The API checks owner or admin. */
export async function chooseSigningProvider(provider: 'PACTLAB' | 'DOCUSIGN'): Promise<void> {
  const result = await apiSend('PUT', '/v1/organization/signing', { provider });
  redirect(`/settings?signing=${result.kind === 'ok' ? 'signing-saved' : result.kind === 'invalid' && result.code ? `signing-${result.code}` : result.kind}#signing`);
}
