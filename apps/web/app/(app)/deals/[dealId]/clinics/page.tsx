import { Badge, Button, Card, CardContent, CardHeader, CardTitle, type SectionAccent } from '@pactlab/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { percentOf } from '../fintech/format';
import { runChecks } from './actions';
import { formatAmount } from '@pactlab/domain';

interface Source {
  documentId: string;
  documentName: string | null;
  pageNumber: number;
  quote: string;
}
type Renewal = 'GRANTED' | 'NONE' | 'NOT_STATED';
type Assignment = 'FREE' | 'CONSENT' | 'PROHIBITED' | 'NOT_STATED';
interface ClinicsView {
  guardrail: string;
  noInventedFigures: string;
  version: string;
  currency: string;
  canRunChecks: boolean;
  analysisDate: string | null;
  owner: {
    threshold: string;
    providerRef: string | null;
    source: Source | null;
    share: { source: 'SERVICE_LINES' | 'CLINICIAN_COLLECTIONS'; from: string; to: string; collected: string | null; collectionShare: string | null; visits: string | null; visitShare: string | null } | null;
    succession: { inPlace: boolean; source: Source | null } | null;
  };
  serviceLines: {
    from: string;
    to: string;
    missing: string[];
    collected: string | null;
    count: number;
    lines: { serviceLine: string; collected: string | null; share: string | null; directCost: string | null; margin: string | null; visits: string; ownerOnly: boolean; providers: { providerRef: string; share: string | null }[] }[];
  } | null;
  referrals: { threshold: string; from: string; to: string; missing: string[]; visits: string; count: number; sources: { source: string; sourceType: string; visits: string; share: string | null; selfReferral: boolean }[] } | null;
  premises: {
    shortTermMonths: number;
    terms: Record<'EXPIRY' | 'RENEWAL' | 'ASSIGNMENT', string>;
    measuredFrom: { date: string; basis: 'EXPECTED_CLOSING' | 'ANALYSIS_DATE'; source: Source | null } | null;
    leases: { documentId: string; documentName: string | null; heading: Source | null; expiresOn: string | null; expiry: Source | null; monthsRemaining: number | null; short: boolean; renewal: Renewal; renewalSource: Source | null; assignment: Assignment; assignmentSource: Source | null }[];
  };
}

const grouped = (value: string | null) => {
  if (value === null) return '—';
  const negative = value.startsWith('-');
  const [whole = ''] = value.replace('-', '').split('.');
  return `${negative ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
};
const RENEWAL = { GRANTED: 'Renewal option granted', NONE: 'No renewal option', NOT_STATED: 'No sentence grants a renewal option' } as const;
const ASSIGNMENT = { FREE: 'May be assigned on a sale', CONSENT: 'Needs the landlord’s consent', PROHIBITED: 'May not be assigned', NOT_STATED: 'Not stated' } as const;
const outcomeMessage = (outcome: string | undefined): Record<string, string> => {
  const checks = outcome?.match(/^ok-checks-(\d+)$/);
  return checks ? { [checks[0]]: `Checks ran. ${checks[1]} new draft${checks[1] === '1' ? '' : 's'} on Findings. A person decides each one.` } : {};
};

/**
 * Small clinics (T-161): what concentrates in a clinic of a few sites — the selling owner's share of
 * visits and collections by service line, the lines only the owner delivers, succession on file or
 * not, visits by referral source, and the clinic lease (term after closing, renewal, assignment). The
 * healthcare evidence (collections, credentials, payer contracts, the P&L by year) is on the Practice
 * tab, reused as it is. Read-only; the checks run into Findings. Documents, dates and arithmetic only.
 */
export default async function ClinicsPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const search = await searchParams;
  const outcome = typeof search['outcome'] === 'string' ? search['outcome'] : undefined;
  const result = await apiGet<ClinicsView>(`/v1/deals/${dealId}/clinics`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const money = (value: string | null) => (value === null ? '—' : formatAmount(value, view.currency, { fraction: 'trim' }));
  const cite = (source: Source) => (
    <Link className="underline" href={`/deals/${dealId}/documents?documentId=${source.documentId}&page=${source.pageNumber}`}>
      {source.documentName ?? 'Document'} p.{source.pageNumber}
    </Link>
  );
  const { owner, serviceLines, referrals, premises } = view;

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={outcomeMessage(outcome)} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Diligence support.</strong> {view.guardrail} {view.noInventedFigures} Only you and your team see this page; the seller never does. Collections, credentials and payer contracts are on the{' '}
        <Link className="underline" href={`/deals/${dealId}/healthcare`}>
          Practice
        </Link>{' '}
        tab.
      </p>

      <Section title="The selling owner" accent="plum">
        {!owner.providerRef ? (
          <p className="text-muted-foreground">No document names the selling owner by their pseudonymous reference (for example “P01 is the selling owner”), so the owner&apos;s share is not read. Ask the seller to say which provider they are.</p>
        ) : (
          <>
            <p>
              <strong>{owner.providerRef}</strong> is named as the selling owner{owner.source ? <> ({cite(owner.source)})</> : null}.
            </p>
            {owner.share ? (
              <dl className="grid gap-3 sm:grid-cols-3">
                <Figure label={`Share of collections, ${owner.share.from} to ${owner.share.to}`} value={percentOf(owner.share.collectionShare, 1)} />
                <Figure label="Share of visits" value={percentOf(owner.share.visitShare, 1)} />
                <Figure label="Collected" value={money(owner.share.collected)} />
              </dl>
            ) : (
              <p className="text-muted-foreground">No service-line or collections-by-clinician export yet. Import one on Sources (Industry data).</p>
            )}
            <p>
              {owner.succession ? (
                <>
                  {owner.succession.inPlace ? <Badge variant="evidence">Cover described</Badge> : <Badge variant="danger">No cover</Badge>} “{owner.succession.source?.quote}” {owner.succession.source ? cite(owner.succession.source) : null}
                </>
              ) : (
                <>
                  <Badge variant="danger">Not in the evidence</Badge> No document describes a succession plan, a transition period or associate coverage.
                </>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              An owner carrying {percentOf(owner.threshold, 0)} or more of collections or visits with no succession or associate coverage on file is drafted on Findings. Read from the {owner.share?.source === 'CLINICIAN_COLLECTIONS' ? 'collections-by-clinician' : 'service-line'} export. A retention risk, never a ranking.
            </p>
          </>
        )}
      </Section>

      <Section title="Service lines" accent="indigo">
        {!serviceLines ? (
          <p className="text-muted-foreground">No service-line export yet. Import service lines by provider on Sources (Industry data) to read each line&apos;s margin and who delivers it.</p>
        ) : (
          <>
            <table className="w-full text-left">
              <caption className="sr-only">Service lines over the trailing twelve months, highest margin first, with the providers who collected on each</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Service line</th>
                  <th scope="col" className="text-right">Collected</th>
                  <th scope="col" className="text-right">Share</th>
                  <th scope="col" className="text-right">Margin after direct costs</th>
                  <th scope="col">Providers</th>
                </tr>
              </thead>
              <tbody>
                {serviceLines.lines.map((line) => (
                  <tr key={line.serviceLine} className="border-t border-border">
                    <td>
                      {line.serviceLine} {line.ownerOnly ? <Badge variant="danger">Owner only</Badge> : null}
                    </td>
                    <td className="text-right" data-numeric>{money(line.collected)}</td>
                    <td className="text-right" data-numeric>{percentOf(line.share, 1)}</td>
                    <td className="text-right" data-numeric>{percentOf(line.margin, 1)}</td>
                    <td>{line.providers.map((provider) => `${provider.providerRef} ${percentOf(provider.share, 0)}`).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              {serviceLines.from} to {serviceLines.to}, {money(serviceLines.collected)} collected across {serviceLines.count} line{serviceLines.count === 1 ? '' : 's'}.{serviceLines.missing.length ? ` Missing months: ${serviceLines.missing.join(', ')}.` : ''} A line no associate collects on is drafted on Findings.
            </p>
          </>
        )}
      </Section>

      <Section title="Referral sources" accent="teal">
        {!referrals ? (
          <p className="text-muted-foreground">No referral export yet. Import visits by referral source on Sources (Industry data).</p>
        ) : (
          <>
            <table className="w-full text-left">
              <caption className="sr-only">Visits by referral source over the trailing twelve months, largest first</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Source</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="text-right">Visits</th>
                  <th scope="col" className="text-right">Share of visits</th>
                </tr>
              </thead>
              <tbody>
                {referrals.sources.map((entry) => (
                  <tr key={entry.source} className="border-t border-border">
                    <td>
                      {entry.source} {!entry.selfReferral && entry.share !== null && Number(entry.share) >= Number(referrals.threshold) ? <Badge variant="danger">Dominant</Badge> : null}
                    </td>
                    <td>{entry.sourceType || '—'}</td>
                    <td className="text-right" data-numeric>{grouped(entry.visits)}</td>
                    <td className="text-right" data-numeric>{percentOf(entry.share, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              {referrals.from} to {referrals.to}, {grouped(referrals.visits)} visits from {referrals.count} source{referrals.count === 1 ? '' : 's'}{referrals.count > referrals.sources.length ? ` (the largest ${referrals.sources.length} shown)` : ''}.{referrals.missing.length ? ` Missing months: ${referrals.missing.join(', ')}.` : ''} One source at {percentOf(referrals.threshold, 0)} or more of visits is drafted on Findings; patients who refer themselves are not one source.
            </p>
          </>
        )}
      </Section>

      <Section title="Premises" accent="bronze">
        {premises.leases.length === 0 ? (
          <p className="text-muted-foreground">No lease in the documents yet. Upload the clinic lease; the intake checklist asks the seller for it.</p>
        ) : (
          <>
            {premises.leases.map((lease) => (
              <div key={lease.documentId} className="flex flex-col gap-2">
                <p>
                  <strong>{lease.documentName ?? 'Lease'}</strong> {lease.heading ? cite(lease.heading) : null}
                </p>
                <dl className="grid gap-3 sm:grid-cols-3">
                  <Figure label={premises.terms.EXPIRY} value={lease.expiresOn ?? 'Not stated'} />
                  <Figure label="Months left after closing" value={lease.monthsRemaining === null ? '—' : String(lease.monthsRemaining)} />
                  <Figure label={premises.terms.RENEWAL} value={RENEWAL[lease.renewal]} />
                </dl>
                <ul className="flex flex-col gap-1">
                  {lease.expiry ? <li>“{lease.expiry.quote}” {cite(lease.expiry)}</li> : null}
                  {lease.renewalSource ? <li>“{lease.renewalSource.quote}” {cite(lease.renewalSource)}</li> : null}
                  <li>
                    {premises.terms.ASSIGNMENT}: {lease.assignment === 'CONSENT' || lease.assignment === 'PROHIBITED' ? <Badge variant="draft">{ASSIGNMENT[lease.assignment]}</Badge> : ASSIGNMENT[lease.assignment]}
                    {lease.assignmentSource ? <> — “{lease.assignmentSource.quote}” {cite(lease.assignmentSource)}</> : null}
                  </li>
                </ul>
                {lease.short && lease.renewal !== 'GRANTED' ? <p><Badge variant="danger">Short term</Badge> Ends within {premises.shortTermMonths} months of closing with no renewal option: relocation or renegotiation risk, drafted on Findings.</p> : null}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              {premises.measuredFrom
                ? premises.measuredFrom.basis === 'EXPECTED_CLOSING'
                  ? <>Measured from the expected closing on {premises.measuredFrom.date}{premises.measuredFrom.source ? <> ({cite(premises.measuredFrom.source)})</> : null}.</>
                  : `No document states a closing date, so the term is measured from ${premises.measuredFrom.date}, the end of the latest month in the exports.`
                : 'No closing date and no exports yet, so the remaining term is not measured.'}{' '}
              A reading of the lease&apos;s sentences, not legal advice.
            </p>
          </>
        )}
      </Section>

      {view.canRunChecks ? (
        <Section title="Clinic checks" accent="slate">
          <p className="text-muted-foreground">
            Runs the pack&apos;s rules over the exports, the P&L and documents: the owner-operator, referral concentration and the lease, with the healthcare checks on collections, credentials and payer contracts, and the multi-year trend. Drafts go to Findings; running again adds nothing already drafted.
          </p>
          <form action={runChecks.bind(null, dealId)}>
            <Button type="submit">Run clinic checks</Button>
          </form>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent: SectionAccent; children: ReactNode }) {
  return (
    <Card accent={accent}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">{children}</CardContent>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-navy/10 p-3">
      <dt className="text-xs font-bold uppercase tracking-wide text-slate-text">{label}</dt>
      <dd className="text-xl font-extrabold tracking-tight" data-numeric>
        {value}
      </dd>
    </div>
  );
}
