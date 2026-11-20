import { isUuid } from '@pactlab/domain';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import Link from 'next/link';
import { apiPost } from '../../../_lib/api';

export const dynamic = 'force-dynamic';

const REASONS: Record<string, string> = {
  conflict: 'This envelope is no longer open for signing, or it isn’t your turn yet (the buyer signs first).',
  forbidden: 'Only the signatory named for your side signs this envelope.',
  unavailable: 'The signing service isn’t reachable just now. Nothing was lost: try again in a few minutes.',
};

/**
 * Embedded signing (T-136): the signatory signs inside Pactlab, in the provider's own signing
 * session, without leaving the pact. The session link is short-lived and opened for the caller
 * only, after Pactlab has checked that they are this envelope's signatory.
 */
export default async function SignPage({ params }: { params: Promise<{ dealId: string; envelopeId: string }> }) {
  const { dealId, envelopeId } = await params;
  if (!isUuid(dealId) || !isUuid(envelopeId)) return <EmptyState title="Not found" description="Open signing from the pact." />;
  const session = await apiPost<{ url: string }>(`/v1/deals/${dealId}/signing/${envelopeId}/session`, {});
  if (session.kind !== 'ok' || !session.data.url.startsWith('https://')) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Signing could not open</CardTitle>
          <CardDescription>{REASONS[session.kind] ?? 'Something went wrong opening the signing session. Nothing was signed; go back and try again.'}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-4 text-sm">
          <Link className="font-semibold text-indigo-ink underline" href={`/deals/${dealId}/loi`}>
            Letter of intent
          </Link>
          <Link className="font-semibold text-indigo-ink underline" href={`/deals/${dealId}/closing`}>
            Closing
          </Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Sign below. When you finish, you come back to the pact; the signed document and its certificate are stored there.{' '}
        <Link className="font-semibold text-indigo-ink underline" href={`/deals/${dealId}/loi`}>
          Leave without signing
        </Link>
      </p>
      <iframe title="Signing session" src={session.data.url} className="h-[80vh] w-full rounded-lg border border-border bg-white" allow="clipboard-write" referrerPolicy="no-referrer" />
    </div>
  );
}
