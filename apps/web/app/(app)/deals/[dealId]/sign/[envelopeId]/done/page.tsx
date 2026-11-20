import { isUuid, type SigningView } from '@pactlab/domain';
import { redirect } from 'next/navigation';
import { apiGet } from '../../../../_lib/api';
import { LeaveFrame } from './leave-frame';

export const dynamic = 'force-dynamic';

/**
 * Where the embedded signing session returns (T-136). Inside the session's frame it first moves the
 * whole window here; then it sends the signer back to the document they signed.
 */
export default async function SignedPage({ params, searchParams }: { params: Promise<{ dealId: string; envelopeId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId, envelopeId } = await params;
  if (!isUuid(dealId) || !isUuid(envelopeId)) redirect('/deals');
  if ((await searchParams)['top'] !== '1') return <LeaveFrame href={`/deals/${dealId}/sign/${envelopeId}/done?top=1`} />;
  const view = await apiGet<SigningView>(`/v1/deals/${dealId}/signing`);
  const subject = view.kind === 'ok' ? view.data.envelopes.find((envelope) => envelope.id === envelopeId)?.subject : undefined;
  redirect(`/deals/${dealId}/${subject === 'TERMS' ? 'closing' : 'loi'}?outcome=ok-esign-returned`);
}
