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
type ClaimStatus = 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED';
type Aspect = 'PHASE' | 'TIMELINE' | 'STATUS';
type ObligationState = 'IN_MODEL' | 'OMITTED' | 'UNDERSTATED' | 'RATE_UNDERSTATED';
type ObligationKind = 'milestone' | 'royalty' | 'licence_fee';
interface PharmaView {
  guardrail: string;
  noInventedFigures: string;
  version: string;
  currency: string;
  canRunChecks: boolean;
  claims: {
    programmes: number;
    registeredTrials: number;
    aspects: Record<Aspect, string>;
    count: number;
    items: { programme: string; aspect: Aspect; statement: string; status: ClaimStatus; rationale: string; sources: (Source | null)[] }[];
    trials: { registryId: string; programme: string; phase: string; status: string; startDate: string | null; primaryCompletion: string | null }[];
  };
  patents: {
    hold: { from: string; basis: 'EXPECTED_CLOSING' | 'ANALYSIS_DATE'; closingSource: Source | null; years: number; yearsStated: boolean; to: string } | null;
    count: number;
    estate: { family: string; product: string; jurisdiction: string; type: string; core: boolean; scheduleExpiry: string | null; expiry: string | null; basis: 'DOCUMENT' | 'SCHEDULE'; source: Source | null }[];
    cliffs: { product: string; coreBasis: boolean; cliff: string | null; jurisdiction: string | null; state: 'IN_HOLD' | 'AFTER_HOLD' | 'BEFORE_CLOSING' | 'NO_DATE'; monthsAfterClosing: number | null; yearsOfHoldAfter: string | null; revenue: { annual: string | null; currency: string | null; from: string; to: string; lines: number } | null }[];
  };
  obligations: {
    modelImported: boolean;
    kinds: Record<ObligationKind, string>;
    states: Record<ObligationState, string>;
    count: number;
    checks: { kind: ObligationKind; payee: string; trigger: string | null; amount: string | null; currency: string | null; rate: string | null; source: Source | null; state: ObligationState | null; model: { obligationId: string; amount: string | null; rate: string | null; expected: string | null } | null; gap: string | null; expected: { programme: string; milestone: string; expected: string } | null }[];
    unmatched: { obligationId: string; counterparty: string; kind: string; trigger: string | null; amount: string | null; rate: string | null }[];
  };
  dependence: {
    manufacturing: { product: string; singleSource: boolean; sole: Source | null; secondSource: { inPlace: boolean; source: Source | null } | null }[];
    scientistThreshold: string;
    scientists: number;
    concentrated: { scientistRef: string; function: string; programmesLed: string; programmeShare: string | null; patentFamilies: string; familyShare: string | null; retention: Source | null }[];
  };
  burn: {
    flatTolerance: string;
    flat: boolean | null;
    change: string | null;
    years: { year: string; amount: string | null; lines: number; files: { uploadId: string; fileName: string }[] }[];
    accelerations: { from: string; to: string; source: Source | null }[];
  };
  trend: { years: { year: string; revenue: string; revenueGrowth: string | null; grossMargin: string | null; operatingMargin: string | null; ratios: { key: string; label: string; amount: string; ratio: string | null }[] }[]; partialYears: string[] };
}

const STATUS = {
  VERIFIED: <Badge variant="evidence">Verified</Badge>,
  CONTRADICTED: <Badge variant="danger">Contradicted</Badge>,
  UNVERIFIED: <Badge variant="draft">Not verified</Badge>,
} as const satisfies Record<ClaimStatus, ReactNode>;
const CLIFF = { IN_HOLD: 'Inside the hold', AFTER_HOLD: 'After the hold', BEFORE_CLOSING: 'Before closing', NO_DATE: 'No date' } as const;
const outcomeMessage = (outcome: string | undefined): Record<string, string> => {
  const checks = outcome?.match(/^ok-checks-(\d+)$/);
  return checks ? { [checks[0]]: `Checks ran. ${checks[1]} new draft${checks[1] === '1' ? '' : 's'} on Findings. A person decides each one.` } : {};
};

/**
 * Pharma and biotech (T-163): the pipeline's phase, timeline and status claims against the registry
 * records and correspondence supplied; the patent estate and each product's cliff against the hold after
 * closing; the agreements' milestones, royalties and fees against the seller's model; single-source
 * manufacturing and key-scientist concentration; R&D by imported year against a timeline brought forward.
 * Read-only; the checks run into Findings. Documents, dates and consistency, never scientific judgment.
 */
export default async function PharmaPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const search = await searchParams;
  const outcome = typeof search['outcome'] === 'string' ? search['outcome'] : undefined;
  const result = await apiGet<PharmaView>(`/v1/deals/${dealId}/pharma`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const money = (value: string | null, currency: string | null = view.currency) => (value === null ? '—' : formatAmount(value, currency ?? view.currency, { fraction: 'trim' }));
  const cite = (source: Source | null) =>
    source ? (
      <Link className="underline" href={`/deals/${dealId}/documents?documentId=${source.documentId}&page=${source.pageNumber}`}>
        {source.documentName ?? 'Document'} p.{source.pageNumber}
      </Link>
    ) : null;
  const { claims, patents, obligations, dependence, burn, trend } = view;

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={outcomeMessage(outcome)} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Diligence support.</strong> {view.guardrail} {view.noInventedFigures} Only you and your team see this page; the seller never does.
      </p>

      <Section title="Pipeline claims" accent="indigo">
        {claims.programmes === 0 ? (
          <p className="text-muted-foreground">No pipeline schedule yet. Import the pipeline and the trial-registry records on Sources (Industry data), and upload the regulatory correspondence.</p>
        ) : (
          <>
            <table className="w-full text-left">
              <caption className="sr-only">Each programme&apos;s claims from the pipeline schedule against the registry records and correspondence</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Claim</th>
                  <th scope="col">Status</th>
                  <th scope="col">What the evidence says</th>
                </tr>
              </thead>
              <tbody>
                {claims.items.map((claim) => (
                  <tr key={`${claim.programme}:${claim.aspect}`} className="border-t border-border align-top">
                    <td>
                      <span className="text-xs text-muted-foreground">{claims.aspects[claim.aspect]}</span>
                      <br />
                      {claim.statement}
                    </td>
                    <td>{STATUS[claim.status]}</td>
                    <td>
                      {claim.rationale}
                      {claim.sources.filter((source): source is Source => source !== null).map((source) => (
                        <span key={`${source.documentId}:${source.pageNumber}:${source.quote}`} className="block text-xs">
                          “{source.quote}” {cite(source)}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              {claims.programmes} programme{claims.programmes === 1 ? '' : 's'} on the schedule, {claims.registeredTrials} registry record{claims.registeredTrials === 1 ? '' : 's'} supplied
              {claims.registeredTrials === 0 ? ' — import the trial-registry records to check the phases' : ''}. Pactlab checks what is filed, never what a trial will show. Each claim is also in the claims register.
            </p>
          </>
        )}
      </Section>

      <Section title="Patent estate" accent="plum">
        {patents.count === 0 ? (
          <p className="text-muted-foreground">No patent schedule yet. Import it on Sources (Industry data); a patent record that states an expiry governs the schedule&apos;s date.</p>
        ) : (
          <>
            <p>
              {patents.hold ? (
                <>
                  Hold: {patents.hold.years} years from {patents.hold.from} to {patents.hold.to}
                  {patents.hold.basis === 'EXPECTED_CLOSING' ? <> — from the expected closing ({cite(patents.hold.closingSource)})</> : ' — no document states a closing date, so from the end of the latest billed month'}
                  {patents.hold.yearsStated ? ', the hold the documents state.' : `, the default when no document states a hold.`}
                </>
              ) : (
                'No closing date and no billing yet, so the hold is not measured.'
              )}
            </p>
            <table className="w-full text-left">
              <caption className="sr-only">Each product&apos;s first patent cliff against the hold</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Product</th>
                  <th scope="col">Protection first ends</th>
                  <th scope="col" className="text-right">Months after closing</th>
                  <th scope="col" className="text-right">Billed revenue, trailing year</th>
                  <th scope="col">Against the hold</th>
                </tr>
              </thead>
              <tbody>
                {patents.cliffs.map((cliff) => (
                  <tr key={cliff.product} className="border-t border-border">
                    <td>{cliff.product}</td>
                    <td>
                      {cliff.cliff ?? '—'} {cliff.jurisdiction ? `(${cliff.jurisdiction}, ${cliff.coreBasis ? 'composition of matter' : 'latest listed'})` : ''}
                    </td>
                    <td className="text-right" data-numeric>{cliff.monthsAfterClosing ?? '—'}</td>
                    <td className="text-right" data-numeric>{cliff.revenue ? money(cliff.revenue.annual, cliff.revenue.currency) : '—'}</td>
                    <td>{cliff.state === 'IN_HOLD' ? <Badge variant="danger">{CLIFF[cliff.state]}</Badge> : CLIFF[cliff.state]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="flex flex-col gap-1 text-xs">
              {patents.estate.map((entry) => (
                <li key={`${entry.family}:${entry.jurisdiction}`}>
                  {entry.family} {entry.jurisdiction} — {entry.product}, {entry.type}: expires {entry.expiry ?? 'not stated'}
                  {entry.basis === 'DOCUMENT' ? (
                    <>
                      {' '}
                      (patent record{entry.scheduleExpiry && entry.scheduleExpiry !== entry.expiry ? `; the schedule says ${entry.scheduleExpiry}` : ''}) {cite(entry.source)}
                    </>
                  ) : (
                    ' (schedule; no patent record states it)'
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">A cliff inside the hold is drafted on Findings and priced on the product&apos;s billed revenue: low one year of it, high a year for each year of the hold left. The reviewer sets the erosion.</p>
          </>
        )}
      </Section>

      <Section title="Licence obligations" accent="bronze">
        {obligations.count === 0 ? (
          <p className="text-muted-foreground">No agreement in the documents states a milestone, royalty or licence fee the company must pay. Upload the licence and collaboration agreements.</p>
        ) : (
          <>
            {!obligations.modelImported ? <p className="text-muted-foreground">The seller&apos;s obligations model is not imported, so the agreements cannot be checked against it. Import it on Sources (Industry data).</p> : null}
            <table className="w-full text-left">
              <caption className="sr-only">Each payment an agreement states, against the seller&apos;s model</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Obligation, as the agreement states it</th>
                  <th scope="col">Seller&apos;s model</th>
                </tr>
              </thead>
              <tbody>
                {obligations.checks.map((check) => (
                  <tr key={`${check.kind}:${check.payee}:${check.trigger ?? ''}:${check.amount ?? check.rate ?? ''}`} className="border-t border-border align-top">
                    <td>
                      <strong>{obligations.kinds[check.kind]}</strong> to {check.payee}:{' '}
                      {check.kind === 'royalty' ? `${percentOf(check.rate, 2)} of ${check.trigger ?? 'net sales'}` : `${money(check.amount, check.currency)}${check.trigger ? ` on ${check.trigger}` : ' a year'}`}
                      {check.expected ? <span className="block text-xs">The pipeline expects {check.expected.programme}&apos;s {check.expected.milestone} in {check.expected.expected}.</span> : null}
                      {check.source ? <span className="block text-xs">“{check.source.quote}” {cite(check.source)}</span> : null}
                    </td>
                    <td>
                      {check.state === null ? '—' : check.state === 'IN_MODEL' ? <Badge variant="evidence">{obligations.states.IN_MODEL}</Badge> : <Badge variant="danger">{obligations.states[check.state]}</Badge>}
                      {check.model ? <span className="block text-xs">{check.model.obligationId}: {check.kind === 'royalty' ? percentOf(check.model.rate, 2) : money(check.model.amount)}</span> : null}
                      {check.gap ? <span className="block text-xs">{money(check.gap, check.currency)} less than the agreement</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {obligations.unmatched.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                In the model but stated by no agreement in the documents: {obligations.unmatched.map((row) => `${row.obligationId} (${row.counterparty}, ${row.kind})`).join('; ')}. Ask for the agreement behind each.
              </p>
            ) : null}
          </>
        )}
      </Section>

      <Section title="Dependence" accent="teal">
        {dependence.manufacturing.length === 0 ? (
          <p className="text-muted-foreground">No document says a product is made by a single manufacturer or supplier.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {dependence.manufacturing.map((entry) => (
              <li key={entry.product}>
                {entry.singleSource ? <Badge variant="danger">Single source</Badge> : <Badge variant="evidence">Second source described</Badge>} <strong>{entry.product}</strong>: “{entry.sole?.quote}” {cite(entry.sole)}
                {entry.secondSource ? <> — “{entry.secondSource.source?.quote}” {cite(entry.secondSource.source)}</> : null}
              </li>
            ))}
          </ul>
        )}
        {dependence.scientists === 0 ? (
          <p className="text-muted-foreground">No R&D roster yet. Import it on Sources (Industry data), by pseudonymous reference only.</p>
        ) : dependence.concentrated.length === 0 ? (
          <p>No scientist leads {percentOf(dependence.scientistThreshold, 0)} or more of the programmes or is named on that share of the patent families.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {dependence.concentrated.map((entry) => (
              <li key={entry.scientistRef}>
                <strong>{entry.scientistRef}</strong> ({entry.function}) leads {entry.programmesLed} programme{entry.programmesLed === '1' ? '' : 's'} ({percentOf(entry.programmeShare, 0)}) and is an inventor on {entry.patentFamilies} famil{entry.patentFamilies === '1' ? 'y' : 'ies'} ({percentOf(entry.familyShare, 0)}).{' '}
                {entry.retention ? (
                  <>
                    <Badge variant="evidence">Retention on file</Badge> “{entry.retention.quote}” {cite(entry.retention)}
                  </>
                ) : (
                  <Badge variant="danger">No retention on file</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Scientists appear only by pseudonymous reference, from the roster&apos;s counts; a retention risk, never a ranking. HR documents are never read.</p>
      </Section>

      <Section title="R&D burn against the timeline" accent="moss">
        {burn.years.length === 0 ? (
          <p className="text-muted-foreground">No P&L by year yet. Import the profit and loss on Sources (Industry data); every imported year is read, a withdrawn import none.</p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-3">
              {burn.years.map((year) => (
                <Figure key={year.year} label={`R&D ${year.year}${year.files[0] ? ` (${year.files.map((file) => file.fileName).join(', ')})` : ''}`} value={money(year.amount)} />
              ))}
            </dl>
            <p>
              {burn.flat === null ? 'One year of R&D: no trend yet.' : burn.flat ? <><Badge variant="draft">Flat</Badge> Every year within {percentOf(burn.flatTolerance, 0)} of the first ({percentOf(burn.change, 1)} first to last).</> : `R&D moved ${percentOf(burn.change, 1)} from first year to last.`}
            </p>
            {burn.accelerations.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {burn.accelerations.map((entry) => (
                  <li key={`${entry.from}:${entry.to}:${entry.source?.quote ?? ''}`}>
                    Brought forward from {entry.from} to {entry.to}: “{entry.source?.quote}” {cite(entry.source)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No document says the development timeline was brought forward.</p>
            )}
            {trend.years.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {trend.years.map((year) => `${year.year}: revenue ${money(year.revenue)}${year.revenueGrowth ? ` (${percentOf(year.revenueGrowth, 1)})` : ''}, gross margin ${percentOf(year.grossMargin, 1)}`).join('; ')}.
                {trend.partialYears.length ? ` Left out because not every month is imported: ${trend.partialYears.join(', ')}.` : ''}
              </p>
            ) : null}
          </>
        )}
      </Section>

      {view.canRunChecks ? (
        <Section title="Pharma checks" accent="slate">
          <p className="text-muted-foreground">
            Runs the pack&apos;s rules over the imports, the P&L and documents: pipeline claims, patent cliffs against the hold, obligations against the agreements, dependence, R&D against the timeline, and the multi-year trend. Drafts go to Findings; running again adds nothing already drafted.
          </p>
          <form action={runChecks.bind(null, dealId)}>
            <Button type="submit">Run pharma checks</Button>
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
