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
interface EcommerceView {
  guardrail: string;
  noInventedFigures: string;
  version: string;
  currency: string;
  canRunChecks: boolean;
  conventions: string[];
  channels: {
    latestMonth: string | null;
    orderRows: number;
    trailing: { from: string; to: string; missing: string[]; net: string | null; gross: string | null; orders: string; returnRate: string | null; contributionMargin: string | null } | null;
    byChannel: { channel: string; platformLabel: string | null; net: string | null; share: string | null; contributionMargin: string | null; returnRate: string | null }[];
  };
  accounts: { account: string; channel: string | null; platformLabel: string | null; net: string | null; share: string | null; material: boolean; owner: 'COMPANY' | 'PERSONAL' | 'UNSTATED'; ownerLabel: string; source: Source | null }[];
  materialShare: string;
  unitEconomics: {
    cohortValue: { horizon: number; cohorts: string[]; ordersPerCustomer: string; from: string; to: string; netOrderValue: string | null; grossOrderValue: string | null; contributionMargin: string | null; ltvContribution: string | null; ltvGross: string | null } | null;
    paid: { from: string; to: string; missing: string[]; spend: string | null; newCustomers: string; cac: string | null } | null;
    ltvToCac: string | null;
  };
  claims: { title: string; status: 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED'; statement: string; rationale: string; source: Source | null }[];
  years: { year: string; net: string | null; returnRate: string | null; contributionMargin: string | null; newCustomers: string; marketing: string | null; cac: string | null }[];
  reconciliation: { tolerance: string; years: { year: string; exportsNet: string | null; pnlRevenue: string | null; difference: string; relative: string | null; accounts: string[]; reconciles: boolean | null }[] };
  inventory: {
    asOf: string;
    lots: number;
    value: string | null;
    agedValue: string | null;
    agedShare: string | null;
    agedDays: number;
    bands: { key: string; label: string; value: string; lots: number }[];
    agedLots: { evidenceId: string; sku: string; location: string; units: string; value: string | null; receivedOn: string; ageDays: number }[];
    agedLotsTotal: number;
  } | null;
  agedLotsShown: number;
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
 * E-commerce and DTC (T-164): channel economics, cohort value and platform dependence — revenue by
 * channel and account recomputed from the exports and reconciled to the P&L, lifetime value on a
 * contribution basis against the deck, who each platform account is registered to, stock age, and
 * acquisition cost and contribution across every imported year. Read-only; the checks run into
 * Findings. Exports and documents only; the buyer's own side.
 */
export default async function EcommercePage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const search = await searchParams;
  const outcome = typeof search['outcome'] === 'string' ? search['outcome'] : undefined;
  const result = await apiGet<EcommerceView>(`/v1/deals/${dealId}/ecommerce`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const money = (value: string | null) => (value === null ? '—' : formatAmount(value, view.currency, { fraction: 'trim' }));
  const cite = (source: Source) => (
    <Link className="underline" href={`/deals/${dealId}/documents?documentId=${source.documentId}&page=${source.pageNumber}`}>
      {source.documentName ?? 'Document'} p.{source.pageNumber}
    </Link>
  );
  const trailing = view.channels.trailing;
  const value = view.unitEconomics.cohortValue;
  const paid = view.unitEconomics.paid;

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <OutcomeBanner outcome={outcome} messages={outcomeMessage(outcome)} />
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <strong>Diligence support.</strong> {view.guardrail} {view.noInventedFigures} Only you and your team see this page; the seller never does.
      </p>

      <Section title="Revenue by channel" accent="indigo">
        {!trailing ? (
          <p className="text-muted-foreground">No orders export yet. Import orders by channel on Sources (Industry data).</p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-4">
              <Figure label={`Net sales, ${trailing.from} to ${trailing.to}`} value={money(trailing.net)} />
              <Figure label="Gross sales" value={money(trailing.gross)} />
              <Figure label="Contribution margin, all channels" value={percentOf(trailing.contributionMargin, 1)} />
              <Figure label="Returns ÷ gross sales" value={percentOf(trailing.returnRate, 1)} />
            </dl>
            <table className="w-full text-left">
              <caption className="sr-only">Net sales, contribution margin and returns by channel, trailing twelve months, from the orders export</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col">Channel</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="text-right">Net sales</th>
                  <th scope="col" className="text-right">Share</th>
                  <th scope="col" className="text-right">Contribution margin</th>
                  <th scope="col" className="text-right">Return rate</th>
                </tr>
              </thead>
              <tbody>
                {view.channels.byChannel.map((channel) => (
                  <tr key={channel.channel} className="border-t border-border">
                    <td>{channel.channel}</td>
                    <td>{channel.platformLabel ?? '—'}</td>
                    <td className="text-right" data-numeric>{money(channel.net)}</td>
                    <td className="text-right" data-numeric>{percentOf(channel.share, 1)}</td>
                    <td className="text-right" data-numeric>{percentOf(channel.contributionMargin, 1)}</td>
                    <td className="text-right" data-numeric>{percentOf(channel.returnRate, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-muted-foreground">
              From {view.channels.orderRows} rows of the orders export; {grouped(trailing.orders)} orders in the trailing twelve months.{trailing.missing.length ? ` Missing months: ${trailing.missing.join(', ')}.` : ''}
            </p>
          </>
        )}
        {view.reconciliation.years.length ? (
          <ul className="flex flex-col gap-1">
            {view.reconciliation.years.map((year) => (
              <li key={year.year}>
                {year.reconciles ? <Badge variant="reviewed">Reconciles</Badge> : <Badge variant="danger">Does not reconcile</Badge>} {year.year}: P&L revenue {money(year.pnlRevenue)} ({year.accounts.join(', ')}) against {money(year.exportsNet)} of net sales in the exports.
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No complete year in both the orders export and the imported P&L to reconcile yet.</p>
        )}
      </Section>

      <Section title="Platform accounts" accent="violet">
        <p className="text-muted-foreground">Who each storefront, marketplace and ad account is registered to, as the documents state it. An account carrying {percentOf(view.materialShare, 0)} of net sales or more is material.</p>
        {view.accounts.length === 0 ? (
          <p className="text-muted-foreground">No accounts in the orders export or the documents yet.</p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">Platform accounts, their share of trailing net sales and who holds them</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Account</th>
                <th scope="col" className="text-right">Share of net sales</th>
                <th scope="col">Registered to</th>
              </tr>
            </thead>
            <tbody>
              {view.accounts.map((account) => (
                <tr key={account.account} className="border-t border-border align-top">
                  <td>
                    {account.channel ?? 'Not in the orders export'} <span className="text-xs text-muted-foreground">{account.account}</span>
                  </td>
                  <td className="text-right" data-numeric>{percentOf(account.share, 1)}</td>
                  <td>
                    {account.owner === 'PERSONAL' ? <Badge variant={account.material ? 'danger' : 'draft'}>{account.ownerLabel}</Badge> : account.owner === 'UNSTATED' ? <span className="text-muted-foreground">{account.ownerLabel}</span> : account.ownerLabel}{' '}
                    {account.source ? <span className="text-xs">({cite(account.source)})</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Cohort value and acquisition cost" accent="cobalt">
        {value ? (
          <dl className="grid gap-3 sm:grid-cols-4">
            <Figure label={`Orders per customer, first ${value.horizon} months`} value={grouped(value.ordersPerCustomer)} />
            <Figure label="Contribution margin, consumer channels" value={percentOf(value.contributionMargin, 1)} />
            <Figure label={`LTV, ${value.horizon} months, on contribution`} value={money(value.ltvContribution)} />
            <Figure label="The same on gross sales" value={money(value.ltvGross)} />
          </dl>
        ) : (
          <p className="text-muted-foreground">Lifetime value needs orders by cohort (twelve months of history) and twelve complete months of orders by channel. Import them on Sources (Industry data).</p>
        )}
        {value ? (
          <p className="text-muted-foreground">
            From {value.cohorts.length} cohorts observed for {value.horizon} months ({value.cohorts.join(', ')}) and consumer orders for {value.from} to {value.to}: net order value {money(value.netOrderValue)}, gross {money(value.grossOrderValue)}.
          </p>
        ) : null}
        {paid ? (
          <p>
            Paid acquisition cost {money(paid.cac)}: {money(paid.spend)} of ad spend ÷ {grouped(paid.newCustomers)} attributed new customers, {paid.from} to {paid.to}.{view.unitEconomics.ltvToCac ? ` LTV ÷ CAC on contribution: ${view.unitEconomics.ltvToCac}×.` : ''}
            {paid.missing.length ? ` Missing months: ${paid.missing.join(', ')}.` : ''}
          </p>
        ) : (
          <p className="text-muted-foreground">No ad-spend export yet: acquisition cost is not computed.</p>
        )}
        {view.claims.length === 0 ? (
          <p className="text-muted-foreground">No lifetime-value or acquisition-cost claim found in the documents.</p>
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

      <Section title="Unit economics by year" accent="teal">
        {view.years.length === 0 ? (
          <p className="text-muted-foreground">No complete calendar year in the orders export yet; a year is read only when all twelve months are there.</p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">Net sales, returns, contribution and acquisition cost by calendar year</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col">Year</th>
                <th scope="col" className="text-right">Net sales</th>
                <th scope="col" className="text-right">Return rate</th>
                <th scope="col" className="text-right">Contribution margin (consumer)</th>
                <th scope="col" className="text-right">New customers</th>
                <th scope="col" className="text-right">Advertising (P&L)</th>
                <th scope="col" className="text-right">Acquisition cost</th>
              </tr>
            </thead>
            <tbody>
              {view.years.map((year) => (
                <tr key={year.year} className="border-t border-border">
                  <td>{year.year}</td>
                  <td className="text-right" data-numeric>{money(year.net)}</td>
                  <td className="text-right" data-numeric>{percentOf(year.returnRate, 1)}</td>
                  <td className="text-right" data-numeric>{percentOf(year.contributionMargin, 1)}</td>
                  <td className="text-right" data-numeric>{grouped(year.newCustomers)}</td>
                  <td className="text-right" data-numeric>{money(year.marketing)}</td>
                  <td className="text-right" data-numeric>{money(year.cac)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view.years.some((year) => year.cac === null) ? <p className="text-muted-foreground">Acquisition cost by year needs the P&L for that year; where it is not imported, it is shown as missing.</p> : null}
      </Section>

      <Section title="Stock age" accent="slate">
        {!view.inventory ? (
          <p className="text-muted-foreground">No stock report yet. Import it on Sources (Industry data).</p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-3">
              <Figure label={`Stock at cost, ${view.inventory.asOf}`} value={money(view.inventory.value)} />
              <Figure label={`Older than ${view.inventory.agedDays} days`} value={money(view.inventory.agedValue)} />
              <Figure label="Aged share" value={percentOf(view.inventory.agedShare, 1)} />
            </dl>
            <p className="text-muted-foreground">
              {view.inventory.lots} lots. By age: {view.inventory.bands.map((band) => `${band.label} ${money(band.value)} (${band.lots})`).join(', ')}.
            </p>
            {view.inventory.agedLots.length ? (
              <table className="w-full text-left">
                <caption className="sr-only">Aged stock lots, oldest first (at most {view.agedLotsShown})</caption>
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th scope="col">SKU</th>
                    <th scope="col">Location</th>
                    <th scope="col" className="text-right">Units</th>
                    <th scope="col" className="text-right">Value</th>
                    <th scope="col">Received</th>
                    <th scope="col" className="text-right">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {view.inventory.agedLots.map((lot) => (
                    <tr key={lot.evidenceId} className="border-t border-border">
                      <td>{lot.sku}</td>
                      <td>{lot.location || '—'}</td>
                      <td className="text-right" data-numeric>{grouped(lot.units)}</td>
                      <td className="text-right" data-numeric>{money(lot.value)}</td>
                      <td>{lot.receivedOn}</td>
                      <td className="text-right" data-numeric>{lot.ageDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {view.inventory.agedLotsTotal > view.inventory.agedLots.length ? <p className="text-muted-foreground">Showing the {view.inventory.agedLots.length} oldest of {view.inventory.agedLotsTotal} aged lots.</p> : null}
          </>
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
        <Section title="E-commerce checks" accent="moss">
          <p className="text-muted-foreground">
            Runs the pack&apos;s rules over the orders, cohorts, ad spend, stock report, P&L and documents: the unit-economics claims, channel reconciliation, platform-account ownership, returns, stock age and the multi-year trend. Drafts go to Findings; running again adds nothing already drafted.
          </p>
          <form action={runChecks.bind(null, dealId)}>
            <Button type="submit">Run e-commerce checks</Button>
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
