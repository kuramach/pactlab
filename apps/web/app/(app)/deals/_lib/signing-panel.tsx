import type { EnvelopeStatus, SigningSubject, SigningView } from '@pactlab/domain';
import { Badge, buttonVariants } from '@pactlab/ui';
import Link from 'next/link';
import { apiGet } from './api';

const VARIANT: Record<EnvelopeStatus, 'neutral' | 'draft' | 'calculation' | 'danger'> = {
  SENT: 'draft',
  DELIVERED: 'draft',
  COMPLETED: 'calculation',
  DECLINED: 'danger',
  EXPIRED: 'danger',
  VOIDED: 'danger',
};
const SOURCE = { APP: 'Pactlab', WEBHOOK: 'provider', POLL: 'checked with the provider' } as const;
const when = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

/**
 * A pact's envelopes for one document (T-136): each one's status with the provider's reason, its
 * timeline, the signed files once stored, and "Sign now" for the signatory whose turn it is. Every
 * state is shown; nothing settles silently.
 */
export async function SigningPanel({ dealId, subject }: { dealId: string; subject: SigningSubject }) {
  const result = await apiGet<SigningView>(`/v1/deals/${dealId}/signing`);
  if (result.kind !== 'ok') {
    return <p className="text-sm text-muted-foreground">The e-signature record could not be loaded just now. Reload the page to try again.</p>;
  }
  const envelopes = result.data.envelopes.filter((envelope) => envelope.subject === subject);
  if (envelopes.length === 0) return null;
  return (
    <section aria-label="E-signature" className="flex flex-col gap-3">
      <h3 className="text-sm font-bold text-navy">E-signature</h3>
      <ul className="flex flex-col gap-3">
        {envelopes.map((envelope) => (
          <li key={envelope.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">
                {subject === 'LOI' ? 'Letter' : 'Terms'} v{envelope.version}
              </span>
              <Badge variant={VARIANT[envelope.status]}>{envelope.statusLabel}</Badge>
              <span className="text-muted-foreground">
                {envelope.provider} · sent {envelope.sentAt.slice(0, 10)}
              </span>
              {envelope.canSignEmbedded ? (
                <Link href={`/deals/${dealId}/sign/${envelope.id}`} className={buttonVariants({ size: 'sm' })}>
                  Sign now
                </Link>
              ) : null}
            </div>
            {envelope.reason ? <p className="text-rose">Reason given: “{envelope.reason}”</p> : null}
            {subject === 'LOI' && envelope.status === 'EXPIRED' ? (
              <p className="font-semibold text-rose">Expired unsigned: exclusivity never started. Draft a new letter to try again.</p>
            ) : null}
            <ol className="flex flex-col gap-0.5 text-xs text-muted-foreground" aria-label="Timeline">
              {envelope.timeline.map((entry) => (
                <li key={`${entry.status}-${entry.at}`}>
                  {when(entry.at)} · {entry.label}
                  {entry.reason ? ` (${entry.reason})` : ''} · from {SOURCE[entry.source]}
                </li>
              ))}
            </ol>
            {envelope.artifacts.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {envelope.artifacts.map((artifact) => (
                  <a
                    key={artifact.kind}
                    className="font-semibold text-indigo-ink underline"
                    href={`/deals/${dealId}/signing/${envelope.id}/${artifact.kind === 'SIGNED_DOCUMENT' ? 'signed' : 'certificate'}`}
                    title={`SHA-256 ${artifact.sha256}`}
                  >
                    {artifact.label}
                  </a>
                ))}
              </div>
            ) : null}
            {envelope.artifactsPending ? <p className="text-xs text-amber-900">Signed. The signed files are not stored yet; Pactlab fetches them again each time this page is opened.</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
