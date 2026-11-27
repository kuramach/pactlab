import { Badge, Button, Card, CardContent, CardHeader, CardTitle, type SectionAccent } from '@pactlab/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { runChecks } from './actions';
import { percentOf } from './format';
import { formatAmount } from '@pactlab/domain';

interface Source {
  documentId: string;
  documentName: string | null;
  pageNumber: number;
  quote: string;
}
interface Window {
  from: string;
  to: string;
  missing: string[];
  volume: string | null;
  transactions: string;
  netRevenue: string | null;
  takeRate: string | null;
  rows: number;
}
interface FintechView {
  guardrail: string;
  noInventedFigures: string;
  version: string;
  currency: string;
  canRunChecks: boolean;
  analysisDate: string | null;
  volume: { latestMonth: string | null; processors: string[]; processorRows: number; trailing: Window | null; prior: Window | null; growth: string | null };
  claims: { title: string; status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED'; statement: string; rationale: string; source: Source | null }[];
  thresholds: { measure: 'CHARGEBACK' | 'FRAUD'; basis: 'COUNT' | 'VOLUME'; limit: string; latestQuarter: string | null; latestRate: string | null; breached: boolean | null; source: Source }[];
  quarters: { quarter: string; volume: string | null; transactions: string; chargebacks: string; chargebackRate: string | null; fraudLosses: string | null; fraudRate: string | null }[];
  quartersShown: number;
  licences: { evidenceId: string; licenceId: string; kindLabel: string; jurisdiction: string; authority: string; registerStatus: string; registerExpiresOn: string | null; expiresOn: string | null; state: 'LAPSED' | 'NEAR_EXPIRY' | 'PENDING' | 'ACTIVE' | 'NO_EXPIRY'; registerDiffers: boolean; source: Source | null }[];
  nearExpiryDays: number;
  compliance: { kind: string; label: string; present: boolean; documents: { documentId: string; documentName: string | null; date: string | null; consentOrder: boolean; recognisedBy: 'HEADING' | 'CATEGORY'; source: Source | null }[] }[];
  reconciliation: { tolerance: string; years: { year: string; processorNetRevenue: string | null; pnlPaymentsRevenue: string | null; difference: string; relative: string | null; accounts: string[]; reconciles: boolean | null }[] };
  trend: {
    version: string;
    partialYears: string[];
    conventions: string[];
    years: { year: string; basis: 'STATED' | 'ROLLED_UP'; revenue: string; revenueGrowth: string | null; grossMargin: string | null; operatingMargin: string | null; ratios: { key: string; label: string; amount: string; ratio: string | null }[]; lines: number; files: { uploadId: string; fileName: string }[] }[];
  };
}

const grouped = (value: string | null) => {
  if (value === null) return '—';
  const negative = value.startsWith('-');
  const [whole = '', fraction] = value.replace('-', '').split('.');
  return `${negative ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction && /[1-9]/.test(fraction) ? `.${fraction.slice(0, 2)}` : ''}`;
};
const CLAIM_BADGE = { VERIFIED: 'reviewed', CONTRADICTED: 'danger', UNVERIFIED: 'draft' } as const;
const STATE = { LAPSED: 'Lapsed', NEAR_EXPIRY: 'Expires soon', PENDING: 'Pending', ACTIVE: 'Active', NO_EXPIRY: 'No expiry stated' } as const;
const MEASURE = { CHARGEBACK: 'Chargeback rate', FRAUD: 'Fraud-loss rate' } as const;
const OUTCOMES: Record<string, string> = {};
const outcomeMessage = (outcome: string | undefined): Record<string, string> => {
  const checks = outcome?.match(/^ok-checks-(\d+)$/);
  if (checks) return { [checks[0]]: `Checks ran. ${checks[1]} new draft${checks[1] === '1' ? '' : 's'} on Findings. A person decides each one.` };
  return OUTCOMES;
};

/**
 * Fintech (T-159): payments and lending economics checked against processor and licence evidence —
 * volume and take rate recomputed from the processor exports, the deck's claims against them, loss
 * rates against the thresholds the documents state, the licence and sponsor register, compliance
 * evidence as present or absent, and the P&L across every imported year. Read-only; the checks run
 * into Findings. Diligence support only; the buyer's own side.
 */
export default async function FintechPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const search = await searchParams;
  const outcome = typeof search['outcome'] === 'string' ? search['outcome'] : undefined;
  const result = await apiGet<FintechView>(`/v1/deals/${dealId}/fintech`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const money = (value: string | null) => (value === null ? '—' : formatAmount(value, view.currency, { fraction: 'trim' }));
  const cite = (source: Source) => (
    <Link className="underline" href={`/deals/${dealId}/documents?documentId=${source.documentId}&page=${source.pageNumber}`}>
      {source.documentName ?? 'Document'} p.{source.pageNumber}
    </Link>
  );
  const trailing = view.volume.trailing;

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={outcomeMessage(outcome)} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Diligence support.</strong> {view.guardrail} {view.noInventedFigures} Only you and your team see this page; the seller never does.
      </p>

      <Section title="Processed volume and take rate" accent="indigo">
        {!trailing ? (
          <p className="text-muted-foreground">No processor export yet. Import the processor or bank settlement export on Sources (Industry data).</p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-4">
              <Figure label={`TPV, ${trailing.from} to ${trailing.to}`} value={money(trailing.volume)} />
              <Figure label="Growth on the year before" value={percentOf(view.volume.growth, 1)} />
              <Figure label="Net revenue on volume" value={money(trailing.netRevenue)} />
              <Figure label="Effective take rate" value={percentOf(trailing.takeRate, 2)} />
            </dl>
            <p className="text-muted-foreground">
              From {view.volume.processorRows} processor-months across {view.volume.processors.join(', ') || 'no processor'}; {grouped(trailing.transactions)} settled transactions in the trailing twelve months.
              {trailing.missing.length ? ` Missing months: ${trailing.missing.join(', ')}.` : ''}
            </p>
          </>
        )}
      </Section>

      <Section title="Claims register" accent="cobalt">
        {view.claims.length === 0 ? (
          <p className="text-muted-foreground">No TPV, growth, take-rate or retention claim found in the documents.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.claims.map((claim) => (
              <li key={claim.title} className="rounded-lg border border-border p-3">
                <p>
                  <Badge variant={CLAIM_BADGE[claim.status]}>{claim.status.toLowerCase()}</Badge> “{claim.statement}” {claim.source ? <>({cite(claim.source)})</> : null}
                </p>
                <p className="text-muted-foreground">{claim.rationale}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Chargebacks and fraud losses" accent="teal">
        {view.thresholds.length ? (
          <ul className="flex flex-col gap-1">
            {view.thresholds.map((threshold) => (
              <li key={threshold.measure}>
                {threshold.breached ? <Badge variant="danger">Breached</Badge> : <Badge variant="reviewed">Within</Badge>} {MEASURE[threshold.measure]} {threshold.latestQuarter ?? ''}: {percentOf(threshold.latestRate, 2)} against {percentOf(threshold.limit, 2)}{' '}
                {threshold.basis === 'COUNT' ? 'by count' : 'of processed volume'}, as {cite(threshold.source)} states.
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No document in the evidence states a chargeback or fraud-loss threshold. Rates are shown as computed; nothing is compared.</p>
        )}
        {view.quarters.length ? (
          <table className="w-full text-left">
            <caption className="sr-only">Loss rates by quarter, from the processor exports (latest {view.quartersShown} quarters)</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Quarter</th>
                <th scope="col" className="text-right">Volume</th>
                <th scope="col" className="text-right">Transactions</th>
                <th scope="col" className="text-right">Chargebacks</th>
                <th scope="col" className="text-right">Chargeback rate</th>
                <th scope="col" className="text-right">Fraud-loss rate</th>
              </tr>
            </thead>
            <tbody>
              {view.quarters.map((quarter) => (
                <tr key={quarter.quarter} className="border-t border-border">
                  <td>{quarter.quarter}</td>
                  <td className="text-right" data-numeric>{money(quarter.volume)}</td>
                  <td className="text-right" data-numeric>{grouped(quarter.transactions)}</td>
                  <td className="text-right" data-numeric>{grouped(quarter.chargebacks)}</td>
                  <td className="text-right" data-numeric>{percentOf(quarter.chargebackRate, 2)}</td>
                  <td className="text-right" data-numeric>{percentOf(quarter.fraudRate, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>

      <Section title="Licences and sponsor agreements" accent="violet">
        <p className="text-muted-foreground">
          Status at {view.analysisDate ?? 'no analysis date (no processor export)'}; a licence or agreement expiring within {view.nearExpiryDays} days is flagged. Where a document states the expiry, it governs.
        </p>
        {view.licences.length === 0 ? (
          <p className="text-muted-foreground">No licence register yet. Import it on Sources (Industry data).</p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">Licence and sponsor register</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Licence or agreement</th>
                <th scope="col">Issued by</th>
                <th scope="col">Register</th>
                <th scope="col">Expires</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {view.licences.map((licence) => (
                <tr key={licence.evidenceId} className="border-t border-border align-top">
                  <td>
                    {licence.jurisdiction} {licence.kindLabel.toLowerCase()} <span className="text-xs text-muted-foreground">{licence.licenceId}</span>
                  </td>
                  <td>{licence.authority}</td>
                  <td>
                    {licence.registerStatus}
                    {licence.registerExpiresOn ? `, to ${licence.registerExpiresOn}` : ''}
                  </td>
                  <td>
                    {licence.expiresOn ?? '—'} {licence.source ? <span className="text-xs">({cite(licence.source)})</span> : null}
                    {licence.registerDiffers ? <span className="block text-xs text-muted-foreground">The register gives another date.</span> : null}
                  </td>
                  <td>{licence.state === 'LAPSED' ? <Badge variant="danger">{STATE[licence.state]}</Badge> : licence.state === 'NEAR_EXPIRY' ? <Badge variant="draft">{STATE[licence.state]}</Badge> : STATE[licence.state]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Compliance evidence" accent="slate">
        <ul className="flex flex-col gap-2">
          {view.compliance.map((entry) => (
            <li key={entry.kind}>
              {entry.present ? <Badge variant="evidence">On file</Badge> : <Badge variant="danger">Not in the evidence</Badge>} <strong>{entry.label}</strong>
              {entry.documents.length ? (
                <ul className="ml-5 list-disc text-muted-foreground">
                  {entry.documents.map((document) => (
                    <li key={document.documentId}>
                      {document.source ? cite(document.source) : (document.documentName ?? 'Document')}
                      {document.date ? `, dated ${document.date}` : ''}
                      {document.consentOrder ? ' — a consent order, for counsel to read' : ''}
                      {document.recognisedBy === 'CATEGORY' ? ' (filed under this category)' : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted-foreground"> — absent; request it from the seller.</span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="P&L by year" accent="plum">
        {view.trend.years.length === 0 ? (
          <p className="text-muted-foreground">No P&L imported yet. Import one or more fiscal years on Sources (Profit and loss); every year imported is read.</p>
        ) : (
          <>
            <table className="w-full text-left">
              <caption className="sr-only">Revenue, margins and key expense ratios by fiscal year, from the imported P&L</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Year</th>
                  <th scope="col" className="text-right">Revenue</th>
                  <th scope="col" className="text-right">Growth</th>
                  <th scope="col" className="text-right">Gross margin</th>
                  <th scope="col" className="text-right">Operating margin</th>
                  {view.trend.years[0]?.ratios.map((ratio) => (
                    <th key={ratio.key} scope="col" className="text-right">
                      {ratio.label} ÷ revenue
                    </th>
                  ))}
                  <th scope="col">From</th>
                </tr>
              </thead>
              <tbody>
                {view.trend.years.map((year) => (
                  <tr key={year.year} className="border-t border-border">
                    <td>{year.year}</td>
                    <td className="text-right" data-numeric>{money(year.revenue)}</td>
                    <td className="text-right" data-numeric>{percentOf(year.revenueGrowth, 1)}</td>
                    <td className="text-right" data-numeric>{percentOf(year.grossMargin, 1)}</td>
                    <td className="text-right" data-numeric>{percentOf(year.operatingMargin, 1)}</td>
                    {year.ratios.map((ratio) => (
                      <td key={ratio.key} className="text-right" data-numeric>{percentOf(ratio.ratio, 2)}</td>
                    ))}
                    <td className="text-xs text-muted-foreground">
                      {year.lines} rows, {year.files.map((file) => file.fileName).join(', ') || 'no file'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {view.trend.years.length === 1 ? <p className="text-muted-foreground">One fiscal year imported: there is no trend yet. Import earlier years to read one.</p> : null}
            {view.trend.partialYears.length ? <p className="text-muted-foreground">Left out because not every month is imported: {view.trend.partialYears.join(', ')}.</p> : null}
          </>
        )}
        {view.reconciliation.years.length ? (
          <ul className="flex flex-col gap-1">
            {view.reconciliation.years.map((year) => (
              <li key={year.year}>
                {year.reconciles ? <Badge variant="reviewed">Reconciles</Badge> : <Badge variant="danger">Does not reconcile</Badge>} {year.year}: P&L payments revenue {money(year.pnlPaymentsRevenue)} ({year.accounts.join(', ')}) against {money(year.processorNetRevenue)} of net revenue in the processor exports.
              </li>
            ))}
          </ul>
        ) : null}
        <Conventions items={view.trend.conventions} />
      </Section>

      {view.canRunChecks ? (
        <Section title="Fintech checks" accent="moss">
          <p className="text-muted-foreground">
            Runs the pack&apos;s rules over the loan tape, AML alerts, processor exports, licence register, P&L and documents: the claims register, licence status, loss rates against stated thresholds, compliance evidence and the multi-year trend. Drafts go to Findings; running again adds nothing already drafted.
          </p>
          <form action={runChecks.bind(null, dealId)}>
            <Button type="submit">Run fintech checks</Button>
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

function Conventions({ items }: { items: readonly string[] }) {
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">How this is computed</summary>
      <ul className="mt-1 list-disc pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}
