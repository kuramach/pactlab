import { Badge, Button, Card, CardContent, CardHeader, CardTitle, type SectionAccent } from '@pactlab/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { percentOf } from '../fintech/format';
import { runChecks } from './actions';

interface Source {
  documentId: string;
  documentName: string | null;
  pageNumber: number;
  quote: string;
}
interface Share {
  key: string;
  billed: string | null;
  share: string | null;
  rows: number;
}
interface ServicesView {
  guardrail: string;
  noInventedFigures: string;
  version: string;
  currency: string;
  canRunChecks: boolean;
  conventions: string[];
  fees: {
    latestMonth: string | null;
    billingRows: number;
    trailing: { from: string; to: string; missing: string[]; billed: string | null; standard: string | null; collected: string | null; hoursWorked: string; hoursBilled: string; realization: string | null; collection: string | null } | null;
    utilization: { from: string; to: string; months: number; available: string; billable: string; rate: string | null } | null;
    recurringShare: string | null;
    byEngagement: (Share & { label: string })[];
  };
  clients: Share[];
  clientsTotal: number;
  feeEarners: Share[];
  feeEarnersTotal: number;
  sharesShown: number;
  claims: { title: string; status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED'; statement: string; rationale: string; source: Source | null }[];
  partners: (Share & { clients: number; rainmaker: boolean; coverage: 'COVERED' | 'STATED_NONE' | 'NOT_IN_EVIDENCE'; coverageLabel: string; source: Source | null })[];
  partnerBasis: 'RELATIONSHIP_PARTNER' | 'FEE_EARNER';
  rainmakerShare: string;
  documentsRead: boolean;
  years: { year: string; billed: string | null; standard: string | null; realization: string | null; collection: string | null }[];
  reconciliation: { tolerance: string; years: { year: string; exportsBilled: string | null; pnlRevenue: string | null; difference: string; relative: string | null; accounts: string[]; reconciles: boolean | null }[] };
  ageing: { ledger: string; label: string; years: { year: string; asOf: string; total: string; over90: string; over90Share: string | null; bands: { band: string; label: string; amount: string }[] }[] }[];
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
const OUTCOMES: Record<string, string> = {};
const outcomeMessage = (outcome: string | undefined): Record<string, string> => {
  const checks = outcome?.match(/^ok-checks-(\d+)$/);
  if (checks) return { [checks[0]]: `Checks ran. ${checks[1]} new draft${checks[1] === '1' ? '' : 's'} on Findings. A person decides each one.` };
  return OUTCOMES;
};

/**
 * IT and professional services (T-167): utilization, realization and the people the fees depend on —
 * fees, realization and collection from the time-and-billing export, reconciled to the P&L by year; fees
 * by client, fee-earner and partner book against the deck's ceilings; the recurring split; WIP and debtor
 * ageing by year; the covenant register against each rainmaker; and the P&L across every imported year.
 * Read-only; the checks run into Findings. Documents and arithmetic only, fee-earners by pseudonymous
 * reference; the buyer's own side.
 */
export default async function ServicesPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const search = await searchParams;
  const outcome = typeof search['outcome'] === 'string' ? search['outcome'] : undefined;
  const result = await apiGet<ServicesView>(`/v1/deals/${dealId}/services`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const money = (value: string | null) => (value === null ? '—' : `${view.currency} ${grouped(value)}`);
  const cite = (source: Source) => (
    <Link className="underline" href={`/deals/${dealId}/documents?documentId=${source.documentId}&page=${source.pageNumber}`}>
      {source.documentName ?? 'Document'} p.{source.pageNumber}
    </Link>
  );
  const trailing = view.fees.trailing;
  const usage = view.fees.utilization;
  const shareTable = (caption: string, heading: string, rows: Share[], total: number) => (
    <>
      <table className="w-full text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col">{heading}</th>
            <th scope="col" className="text-right">Fees billed</th>
            <th scope="col" className="text-right">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-border">
              <td>{row.key}</td>
              <td className="text-right" data-numeric>{money(row.billed)}</td>
              <td className="text-right" data-numeric>{percentOf(row.share, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > rows.length ? <p className="text-muted-foreground">Showing the {rows.length} largest of {total}.</p> : null}
    </>
  );

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={outcomeMessage(outcome)} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Diligence support.</strong> {view.guardrail} {view.noInventedFigures} Only you and your team see this page; the seller never does.
      </p>

      <Section title="Fees, utilization and realization" accent="indigo">
        {!trailing ? (
          <p className="text-muted-foreground">No time-and-billing export yet. Import it on Sources (Industry data).</p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-4">
              <Figure label={`Fees billed, ${trailing.from} to ${trailing.to}`} value={money(trailing.billed)} />
              <Figure label="Realization (billed ÷ standard value)" value={percentOf(trailing.realization, 1)} />
              <Figure label="Collection (collected ÷ billed)" value={percentOf(trailing.collection, 1)} />
              <Figure label="Utilization (timesheets)" value={usage ? percentOf(usage.rate, 1) : '—'} />
            </dl>
            <p className="text-muted-foreground">
              From {view.fees.billingRows} rows of the time-and-billing export: {grouped(trailing.hoursWorked)} hours worked and {grouped(trailing.hoursBilled)} billed in the trailing twelve months, {money(trailing.standard)} at standard rates.
              {trailing.missing.length ? ` Missing months: ${trailing.missing.join(', ')}.` : ''}
              {usage ? ` Utilization: ${grouped(usage.billable)} billable of ${grouped(usage.available)} available hours, ${usage.from} to ${usage.to}.` : ' No timesheets summary yet: utilization is not computed.'}
            </p>
          </>
        )}
        {view.years.length === 0 ? (
          <p className="text-muted-foreground">No complete calendar year in the export yet; a year is read only when all twelve months are there.</p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">Fees, standard value, realization and collection by calendar year, from the time-and-billing export</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Year</th>
                <th scope="col" className="text-right">Fees billed</th>
                <th scope="col" className="text-right">Standard value</th>
                <th scope="col" className="text-right">Realization</th>
                <th scope="col" className="text-right">Collection</th>
              </tr>
            </thead>
            <tbody>
              {view.years.map((year) => (
                <tr key={year.year} className="border-t border-border">
                  <td>{year.year}</td>
                  <td className="text-right" data-numeric>{money(year.billed)}</td>
                  <td className="text-right" data-numeric>{money(year.standard)}</td>
                  <td className="text-right" data-numeric>{percentOf(year.realization, 1)}</td>
                  <td className="text-right" data-numeric>{percentOf(year.collection, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view.reconciliation.years.length ? (
          <ul className="flex flex-col gap-1">
            {view.reconciliation.years.map((year) => (
              <li key={year.year}>
                {year.reconciles ? <Badge variant="reviewed">Reconciles</Badge> : <Badge variant="danger">Does not reconcile</Badge>} {year.year}: P&L revenue {money(year.pnlRevenue)} ({year.accounts.join(', ')}) against {money(year.exportsBilled)} of fees in the export.
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No complete year in both the export and the imported P&L to reconcile yet.</p>
        )}
      </Section>

      <Section title="Concentration" accent="violet">
        {view.clients.length === 0 ? (
          <p className="text-muted-foreground">No fees by client yet.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">{shareTable('Fees by client, trailing twelve months', 'Client', view.clients, view.clientsTotal)}</div>
            <div className="flex flex-col gap-2">{shareTable('Fees by fee-earner (pseudonymous), trailing twelve months', 'Fee-earner', view.feeEarners, view.feeEarnersTotal)}</div>
          </div>
        )}
        {view.claims.length === 0 ? (
          <p className="text-muted-foreground">No client or partner concentration ceiling found in the documents.</p>
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
        {view.fees.byEngagement.length ? (
          <p>
            Recurring fees (retainers and managed services): <strong>{percentOf(view.fees.recurringShare, 1)}</strong>. By engagement: {view.fees.byEngagement.map((entry) => `${entry.label} ${money(entry.billed)} (${percentOf(entry.share, 1)})`).join(', ')}.
          </p>
        ) : null}
      </Section>

      <Section title="Rainmakers and covenant cover" accent="cobalt">
        <p className="text-muted-foreground">
          {view.partnerBasis === 'RELATIONSHIP_PARTNER' ? 'Each partner’s book is the fees of the clients whose relationship they hold.' : 'The export names no relationship partner, so books are read by fee-earner.'} A book of {percentOf(view.rainmakerShare, 0)} of fees or more is revenue-carrying. Cover is what the covenant register and similar documents state; this records documents and arithmetic, never an assessment of a person.
        </p>
        {!view.documentsRead ? <p className="text-muted-foreground">No documents read yet: cover is shown once the covenant register is uploaded.</p> : null}
        {view.partners.length === 0 ? (
          <p className="text-muted-foreground">No partner books in the export yet.</p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">Partner books, their share of trailing fees and the covenant cover the documents show</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Reference</th>
                <th scope="col" className="text-right">Clients</th>
                <th scope="col" className="text-right">Share of fees</th>
                <th scope="col">Non-compete or non-solicit</th>
              </tr>
            </thead>
            <tbody>
              {view.partners.map((partner) => (
                <tr key={partner.key} className="border-t border-border align-top">
                  <td>
                    {partner.key} {partner.rainmaker ? <Badge variant="draft">revenue-carrying</Badge> : null}
                  </td>
                  <td className="text-right" data-numeric>{partner.clients}</td>
                  <td className="text-right" data-numeric>{percentOf(partner.share, 1)}</td>
                  <td>
                    {partner.coverage === 'COVERED' ? partner.coverageLabel : <Badge variant={partner.rainmaker ? 'danger' : 'draft'}>{partner.coverageLabel}</Badge>} {partner.source ? <span className="text-xs">({cite(partner.source)})</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="WIP and debtor ageing" accent="teal">
        {view.ageing.length === 0 ? (
          <p className="text-muted-foreground">No ageing reports yet. Import the WIP and debtor ageing on Sources (Industry data).</p>
        ) : (
          view.ageing.map((ledger) => (
            <table key={ledger.ledger} className="w-full text-left">
              <caption className="text-left font-semibold">{ledger.label}</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Report</th>
                  {ledger.years[0]?.bands.map((band) => (
                    <th key={band.band} scope="col" className="text-right">
                      {band.label}
                    </th>
                  ))}
                  <th scope="col" className="text-right">Over 90 days</th>
                </tr>
              </thead>
              <tbody>
                {ledger.years.map((year) => (
                  <tr key={year.asOf} className="border-t border-border">
                    <td>{year.asOf}</td>
                    {year.bands.map((band) => (
                      <td key={band.band} className="text-right" data-numeric>{money(band.amount)}</td>
                    ))}
                    <td className="text-right" data-numeric>
                      {money(year.over90)} ({percentOf(year.over90Share, 1)})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))
        )}
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
                      <td key={ratio.key} className="text-right" data-numeric>{percentOf(ratio.ratio, 1)}</td>
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
        <Conventions items={[...view.conventions, ...view.trend.conventions]} />
      </Section>

      {view.canRunChecks ? (
        <Section title="Professional services checks" accent="moss">
          <p className="text-muted-foreground">
            Runs the pack&apos;s rules over the time and billing, timesheets, headcount movements, ageing reports, P&L and documents: utilization, the concentration claims, realization by year, the fee reconciliation, ageing drift, rainmaker cover, revenue quality and the multi-year trend. Drafts go to Findings; running again adds nothing already drafted.
          </p>
          <form action={runChecks.bind(null, dealId)}>
            <Button type="submit">Run professional services checks</Button>
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
