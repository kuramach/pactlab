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
type RentState = 'MATCHES' | 'OVERSTATED' | 'UNDERSTATED' | 'NO_LEASE';
interface LeasesView {
  guardrail: string;
  noInventedFigures: string;
  version: string;
  currency: string;
  canRunChecks: boolean;
  conventions: string[];
  asOf: string | null;
  hold: { from: string; to: string; basis: 'EXPECTED_CLOSING' | 'ANALYSIS_DATE'; years: number; yearsStated: boolean; closingSource: Source | null } | null;
  leasesRead: number;
  rentRoll: {
    suites: number;
    tolerance: string;
    rows: {
      evidenceId: string;
      tenant: string;
      suite: string;
      rollRent: string | null;
      leaseRent: string | null;
      difference: string | null;
      relative: string | null;
      state: RentState;
      stateLabel: string;
      escalations: number;
      escalation: string | null;
      rollEnd: string | null;
      leaseEnd: string | null;
      expiryMatches: boolean | null;
      leaseTypeLabel: string | null;
      share: string | null;
      source: Source | null;
    }[];
  };
  statementRent: { complete: boolean; tolerance: string; years: { year: string; statement: string | null; leases: string | null; difference: string; relative: string | null; ties: boolean | null }[] };
  recoveries: { tolerance: string; netLeases: number; netShare: string | null; persistent: boolean; years: { year: string; pool: string | null; poolAccounts: string[]; recoverable: string | null; billed: string | null; shortfall: string; relative: string | null; short: boolean }[] };
  obligations: { kind: string; kindLabel: string; party: string; amount: string | null; currency: string; due: string | null; outstanding: boolean; source: Source | null }[];
  obligationsOutstanding: string | null;
  tenants: {
    total: string | null;
    cliffShare: string;
    cliffYears: number;
    rows: { tenant: string; suite: string; rent: string | null; source: 'LEASE' | 'RENT_ROLL'; share: string | null; expiry: string | null; holdYear: number | null; afterHold: boolean; cliff: boolean }[];
    expiryProfile: { label: string; holdYear: number | null; rent: string; share: string | null; tenants: number }[];
  };
  condition: { scheduleImported: boolean; items: { element: string; label: string; amount: string | null; currency: string; covered: string[]; source: Source | null }[] };
  capex: { total: number; rows: { evidenceId: string; item: string; category: string; year: string; amount: string | null; status: string; statusLabel: string }[] };
  rowsShown: number;
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
const RENT_BADGE = { MATCHES: 'reviewed', OVERSTATED: 'danger', UNDERSTATED: 'draft', NO_LEASE: 'draft' } as const;
const OUTCOMES: Record<string, string> = {};
const outcomeMessage = (outcome: string | undefined): Record<string, string> => {
  const checks = outcome?.match(/^ok-checks-(\d+)$/);
  if (checks) return { [checks[0]]: `Checks ran. ${checks[1]} new draft${checks[1] === '1' ? '' : 's'} on Findings. A person decides each one.` };
  return OUTCOMES;
};
const holdYearLabel = (row: { holdYear: number | null; afterHold: boolean }) => (row.afterHold ? 'After the hold' : row.holdYear === null ? '—' : row.holdYear === 0 ? 'Before closing' : `Year ${row.holdYear}`);

/**
 * Commercial property (T-165): the rent roll against the leases, recoveries and expiry cliffs — rent and
 * escalations recomputed lease by lease against the roll and the statements, NNN recoveries against the
 * leases' shares by year, the obligations the buyer inherits, rent share and the expiry profile against the
 * hold, and condition items against the capex schedule. Read-only; the checks run into Findings. Documents
 * and arithmetic only, never an appraisal; the buyer's own side.
 */
export default async function LeasesPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const search = await searchParams;
  const outcome = typeof search['outcome'] === 'string' ? search['outcome'] : undefined;
  const result = await apiGet<LeasesView>(`/v1/deals/${dealId}/commercial-property`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const money = (value: string | null, currency = view.currency) => (value === null ? '—' : `${currency} ${grouped(value)}`);
  const cite = (source: Source) => (
    <Link className="underline" href={`/deals/${dealId}/documents?documentId=${source.documentId}&page=${source.pageNumber}`}>
      {source.documentName ?? 'Document'} p.{source.pageNumber}
    </Link>
  );
  const overstated = view.rentRoll.rows.filter((row) => row.state === 'OVERSTATED').length;

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={outcomeMessage(outcome)} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Diligence support.</strong> {view.guardrail} {view.noInventedFigures} Only you and your team see this page; the seller never does.
      </p>

      <Section title="Rent roll against the leases" accent="indigo">
        {view.rentRoll.suites === 0 ? (
          <p className="text-muted-foreground">No rent roll yet. Import the commercial rent roll on Sources (Industry data).</p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-4">
              <Figure label="Suites on the rent roll" value={String(view.rentRoll.suites)} />
              <Figure label="Leases read" value={String(view.leasesRead)} />
              <Figure label="Rent above the lease" value={String(overstated)} />
              <Figure label="Analysis date" value={view.asOf ?? '—'} />
            </dl>
            {view.leasesRead === 0 ? <p className="text-muted-foreground">No lease read yet. Upload the leases on Documents: each suite is then recomputed from its lease.</p> : null}
            {!view.asOf ? <p className="text-muted-foreground">Import the billing export to set the analysis date the rent is recomputed at.</p> : null}
            <table className="w-full text-left">
              <caption className="sr-only">Monthly base rent on the rent roll against the rent each lease gives at the analysis date</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Tenant</th>
                  <th scope="col" className="text-right">Rent roll, monthly</th>
                  <th scope="col" className="text-right">Lease, monthly</th>
                  <th scope="col" className="text-right">Difference</th>
                  <th scope="col">Expiry, roll · lease</th>
                  <th scope="col">Lease</th>
                </tr>
              </thead>
              <tbody>
                {view.rentRoll.rows.map((row) => (
                  <tr key={row.evidenceId} className="border-t border-border align-top">
                    <td>
                      {row.tenant} <span className="text-xs text-muted-foreground">{row.suite}</span>
                    </td>
                    <td className="text-right" data-numeric>{money(row.rollRent)}</td>
                    <td className="text-right" data-numeric>
                      {money(row.leaseRent)}
                      {row.escalation ? <span className="block text-xs text-muted-foreground">{percentOf(row.escalation, 1)} a year, {row.escalations} increases</span> : null}
                    </td>
                    <td className="text-right" data-numeric>
                      <Badge variant={RENT_BADGE[row.state]}>{row.stateLabel}</Badge> {row.relative ? <span className="text-xs">{percentOf(row.relative, 1)}</span> : null}
                    </td>
                    <td>
                      {row.rollEnd ?? '—'} · {row.leaseEnd ?? '—'} {row.expiryMatches === false ? <Badge variant="danger">Differs</Badge> : null}
                    </td>
                    <td className="text-xs">
                      {row.leaseTypeLabel ?? '—'}
                      {row.share ? `, ${percentOf(row.share, 1)} share` : ''} {row.source ? <>({cite(row.source)})</> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {view.rentRoll.suites > view.rentRoll.rows.length ? <p className="text-muted-foreground">Showing {view.rentRoll.rows.length} of {view.rentRoll.suites} suites.</p> : null}
          </>
        )}
      </Section>

      <Section title="Statements and recoveries by year" accent="teal">
        {view.statementRent.years.length === 0 && view.recoveries.years.length === 0 ? (
          <p className="text-muted-foreground">
            {view.trend.years.length === 0 ? 'No P&L imported yet. Import the operating statement by year on Sources (Profit and loss).' : 'The statements cannot be checked yet: every suite on the rent roll needs its lease read, and the net leases their share of the recoverable expenses.'}
          </p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">The statements’ base rent against the leases, and recoveries billed against recoverable, by year</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Year</th>
                <th scope="col" className="text-right">Base rent, statements</th>
                <th scope="col" className="text-right">Base rent, leases</th>
                <th scope="col" className="text-right">Recoverable under the leases</th>
                <th scope="col" className="text-right">Recoveries billed</th>
                <th scope="col" className="text-right">Shortfall</th>
              </tr>
            </thead>
            <tbody>
              {[...new Set([...view.statementRent.years.map((year) => year.year), ...view.recoveries.years.map((year) => year.year)])].sort().map((year) => {
                const rent = view.statementRent.years.find((entry) => entry.year === year);
                const recovery = view.recoveries.years.find((entry) => entry.year === year);
                return (
                  <tr key={year} className="border-t border-border">
                    <td>{year}</td>
                    <td className="text-right" data-numeric>{money(rent?.statement ?? null)}</td>
                    <td className="text-right" data-numeric>
                      {money(rent?.leases ?? null)} {rent?.ties === false ? <Badge variant="danger">Does not tie</Badge> : null}
                    </td>
                    <td className="text-right" data-numeric>{money(recovery?.recoverable ?? null)}</td>
                    <td className="text-right" data-numeric>{money(recovery?.billed ?? null)}</td>
                    <td className="text-right" data-numeric>
                      {recovery ? (
                        <>
                          {money(recovery.shortfall)} {recovery.short ? <Badge variant="danger">{percentOf(recovery.relative, 1)}</Badge> : <span className="text-xs">{percentOf(recovery.relative, 1)}</span>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {view.recoveries.netLeases ? (
          <p className="text-muted-foreground">
            {view.recoveries.netLeases} net leases give their tenants {percentOf(view.recoveries.netShare, 1)} of the recoverable expenses.{' '}
            {view.recoveries.persistent ? 'Recoveries are short of the leases in every year imported: a trend, drafted on Findings.' : view.recoveries.years.length === 1 ? 'One statement year is imported, so a shortfall reads as one year, not a trend.' : ''}
          </p>
        ) : null}
      </Section>

      <Section title="Tenants and the expiry profile against the hold" accent="violet">
        {!view.hold || view.tenants.rows.length === 0 ? (
          <p className="text-muted-foreground">Import the rent roll and the billing export (and upload the leases and the offering memorandum) to read rent share and expiries against the hold.</p>
        ) : (
          <>
            <p className="text-muted-foreground">
              The hold runs {view.hold.years} years from {view.hold.from}
              {view.hold.basis === 'EXPECTED_CLOSING' ? <> (the expected closing{view.hold.closingSource ? <>, {cite(view.hold.closingSource)}</> : null})</> : ', the analysis date: no closing date is stated'}
              {view.hold.yearsStated ? '.' : '; no hold is stated, so five years is assumed.'} A tenant at {percentOf(view.tenants.cliffShare, 0)} of the rent or more expiring in the first {view.tenants.cliffYears} years is a cliff.
            </p>
            <table className="w-full text-left">
              <caption className="sr-only">Rent expiring by year of the hold</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">When</th>
                  <th scope="col" className="text-right">Monthly rent expiring</th>
                  <th scope="col" className="text-right">Share of rent</th>
                  <th scope="col" className="text-right">Leases</th>
                </tr>
              </thead>
              <tbody>
                {view.tenants.expiryProfile.map((bucket) => (
                  <tr key={bucket.label} className="border-t border-border">
                    <td>{bucket.label}</td>
                    <td className="text-right" data-numeric>{money(bucket.rent)}</td>
                    <td className="text-right" data-numeric>{percentOf(bucket.share, 1)}</td>
                    <td className="text-right" data-numeric>{bucket.tenants}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="w-full text-left">
              <caption className="sr-only">Rent share by tenant and the year of the hold each lease expires in</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Tenant</th>
                  <th scope="col" className="text-right">Share of rent</th>
                  <th scope="col">Lease ends</th>
                  <th scope="col">In the hold</th>
                </tr>
              </thead>
              <tbody>
                {view.tenants.rows.map((row) => (
                  <tr key={row.suite} className="border-t border-border">
                    <td>
                      {row.tenant} <span className="text-xs text-muted-foreground">{row.source === 'LEASE' ? 'from the lease' : 'from the rent roll'}</span>
                    </td>
                    <td className="text-right" data-numeric>{percentOf(row.share, 1)}</td>
                    <td>{row.expiry ?? '—'}</td>
                    <td>
                      {holdYearLabel(row)} {row.cliff ? <Badge variant="danger">Cliff</Badge> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>

      <Section title="Obligations register" accent="bronze">
        {view.obligations.length === 0 ? (
          <p className="text-muted-foreground">No tenant improvement allowance, leasing commission or committed capex in the documents or the capex schedule yet.</p>
        ) : (
          <>
            <table className="w-full text-left">
              <caption className="sr-only">Tenant improvement allowances, leasing commissions and committed capex, and whether each falls to the buyer</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Obligation</th>
                  <th scope="col" className="text-right">Amount</th>
                  <th scope="col">Due</th>
                  <th scope="col">Falls to</th>
                </tr>
              </thead>
              <tbody>
                {view.obligations.map((entry) => (
                  <tr key={`${entry.kind}:${entry.party}:${entry.due ?? ''}`} className="border-t border-border align-top">
                    <td>
                      {entry.kindLabel}: {entry.party} {entry.source ? <span className="text-xs">({cite(entry.source)})</span> : <span className="text-xs text-muted-foreground">(capex schedule)</span>}
                    </td>
                    <td className="text-right" data-numeric>{money(entry.amount, entry.currency)}</td>
                    <td>{entry.due ?? 'Not stated'}</td>
                    <td>{entry.outstanding ? <Badge variant="danger">The buyer</Badge> : 'The seller, before closing'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-muted-foreground">Falling to the buyer: {money(view.obligationsOutstanding)}. Each is drafted on Findings, priced at the amount stated.</p>
          </>
        )}
      </Section>

      <Section title="Condition reports against the capex schedule" accent="slate">
        {!view.condition.scheduleImported ? <p className="text-muted-foreground">No capex schedule imported yet. Import the seller&apos;s capex schedule on Sources (Industry data): condition items are checked against it.</p> : null}
        {view.condition.items.length === 0 ? (
          <p className="text-muted-foreground">No property condition or environmental report recommending work at a stated cost has been read yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.condition.items.map((item) => (
              <li key={`${item.element}:${item.amount ?? ''}`} className="rounded-md border border-border p-2">
                <span className="font-semibold">{item.label}</span> {money(item.amount, item.currency)} —{' '}
                {item.covered.length > 0 ? `on the capex schedule (${item.covered.join(', ')})` : <Badge variant="danger">Not on the capex schedule</Badge>} {item.source ? <span className="text-xs">({cite(item.source)})</span> : null}
              </li>
            ))}
          </ul>
        )}
        {view.capex.rows.length > 0 ? (
          <table className="w-full text-left">
            <caption className="sr-only">The seller&apos;s capex schedule</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Project</th>
                <th scope="col">Year</th>
                <th scope="col" className="text-right">Amount</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {view.capex.rows.map((row) => (
                <tr key={row.evidenceId} className="border-t border-border">
                  <td>{row.item}</td>
                  <td>{row.year}</td>
                  <td className="text-right" data-numeric>{money(row.amount)}</td>
                  <td>{row.statusLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {view.capex.total > view.capex.rows.length ? <p className="text-muted-foreground">Showing {view.capex.rows.length} of {view.capex.total} projects.</p> : null}
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
        <Section title="Commercial property checks" accent="moss">
          <p className="text-muted-foreground">
            Runs the pack&apos;s rules over the rent roll, the CAM reconciliation, the capex schedule, the P&L and the documents: rent against the leases and the statements, recoveries by year, the obligations register, the expiry cliff, condition items and the multi-year trend. Drafts go to Findings; running again adds nothing already drafted.
          </p>
          <form action={runChecks.bind(null, dealId)}>
            <Button type="submit">Run commercial property checks</Button>
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
