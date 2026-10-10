import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@pactlab/ui';
import { Glossed, IconTile, Term, type Accent } from '@pactlab/ui';
import { BarChart3, CalendarClock, Gauge, Grid3x3, PieChart, Repeat, ShieldCheck, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { DonutChart, HeatmapChart, LineChart, WaterfallChart } from '../../../_lib/charts';
import { notFound } from 'next/navigation';
import { isUuidParam } from '../../_lib/filters';
import { ApiState } from '../../_lib/states';
import { metricsApi, type MetricView, type MetricsSummaryView, type SourceRef } from '../../../metrics/_lib/api';
import {
  EXCLUSION_LABELS,
  formatDecimal,
  formatMoney,
  formatRatio,
  parseMonthParam,
  RECONCILIATION_LABELS,
} from '../../../metrics/_lib/format';
import { approveDifference, recordReconciliation } from './actions';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const HEADLINE = [
  'ARR',
  'MRR',
  'NRR',
  'GRR',
  'LOGO_RETENTION',
  'ARPA',
  'ACTIVE_CUSTOMERS',
  'TOP_CUSTOMER_SHARE',
];

const OUTCOMES: Record<string, string> = {
  approved: 'Difference approved and recorded.',
  recorded: 'Reconciliation recorded.',
  conflict: 'Evidence changed since this page loaded. Review the new figures before approving.',
  forbidden: 'Your role cannot perform this action.',
  invalid: 'Add a note of at least three characters explaining the decision.',
  'signed-out': 'Sign in to record decisions.',
};

function metricValue(metric: MetricView): string {
  if (metric.value === null) return '—';
  if (metric.unit === 'RATIO') return formatRatio(metric.value);
  if (metric.unit === 'MONEY')
    return formatMoney({ amount: metric.value, currency: metric.currency ?? '' });
  return formatDecimal(metric.value);
}

function EvidenceLink({ dealId, source }: { dealId: string; source: SourceRef }) {
  return (
    <Link
      href={`/deals/${dealId}/evidence/${source.evidenceId}`}
      className="font-mono hover:underline"
    >
      {source.sourceRecordId}
    </Link>
  );
}

const METRIC_ICONS: Record<string, { icon: typeof TrendingUp; accent: Accent }> = {
  arr: { icon: TrendingUp, accent: 'indigo' },
  mrr: { icon: CalendarClock, accent: 'teal' },
  nrr: { icon: Repeat, accent: 'amber' },
  grr: { icon: ShieldCheck, accent: 'navy' },
};

/** Flip the sign of a decimal string, for amounts shown as reductions. */
function negate(amount: string): string {
  if (/^-?0+(\.0+)?$/.test(amount)) return amount.replace('-', '');
  return amount.startsWith('-') ? amount.slice(1) : `-${amount}`;
}

/** Top five customers' share of ARR, the rest grouped. */
function concentrationSlices(customers: readonly { customerName: string | null; customerId: string; share: string | null }[]) {
  const top = customers.slice(0, 5).map((customer) => ({ name: customer.customerName ?? customer.customerId, value: Number(customer.share ?? 0) }));
  const rest = customers.slice(5).reduce((sum, customer) => sum + Number(customer.share ?? 0), 0);
  return rest > 0 ? [...top, { name: 'All others', value: rest, color: '#cbd5e1' }] : top;
}

function MetricCard({ dealId, metric }: { dealId: string; metric: MetricView }) {
  const look = METRIC_ICONS[metric.key.toLowerCase()] ?? { icon: Gauge, accent: 'indigo' as Accent };
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-2">
          <IconTile accent={look.accent}>
            <look.icon />
          </IconTile>
          <Badge variant="calculation">calculated</Badge>
        </div>
        <CardDescription className="text-xs font-bold uppercase tracking-wide text-slate-text">
          <Glossed text={metric.label} />
        </CardDescription>
        <CardTitle className="text-3xl font-extrabold">{metricValue(metric)}</CardTitle>
        {metric.unavailableReason ? (
          <p className="text-xs text-muted-foreground">{metric.unavailableReason}</p>
        ) : null}
      </CardHeader>
      <CardContent>
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Definition and inputs</summary>
          <dl className="mt-2 flex flex-col gap-1">
            <dt className="font-medium">Formula</dt>
            <dd>{metric.formula}</dd>
            <dt className="font-medium">Time basis</dt>
            <dd>{metric.timeBasis}</dd>
            <dt className="font-medium">Inclusion policy</dt>
            <dd>{metric.inclusionPolicy}</dd>
            <dt className="font-medium">Source records ({metric.inputs.length})</dt>
            <dd className="flex flex-wrap gap-x-2">
              {metric.inputs.slice(0, 12).map((input) => (
                <EvidenceLink key={input.evidenceId} dealId={dealId} source={input} />
              ))}
              {metric.inputs.length > 12 ? <span>+{metric.inputs.length - 12} more</span> : null}
            </dd>
          </dl>
        </details>
      </CardContent>
    </Card>
  );
}

function Reconciliation({ dealId, data }: { dealId: string; data: MetricsSummaryView }) {
  const { reconciliation, approval } = data;
  const asOf = data.report.asOfMonth;
  const canDecide =
    reconciliation.status === 'RECONCILED' || reconciliation.status === 'DIFFERENCE';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          ARR reconciliation
          <Badge
            variant={
              reconciliation.status === 'DIFFERENCE'
                ? 'danger'
                : reconciliation.status === 'RECONCILED'
                  ? 'calculation'
                  : 'neutral'
            }
          >
            {RECONCILIATION_LABELS[reconciliation.status] ?? reconciliation.status}
          </Badge>
          {approval.status === 'APPROVED' ? (
            <Badge variant="reviewed">approved by reviewer</Badge>
          ) : null}
          {approval.status === 'STALE' ? (
            <Badge variant="draft">earlier approval is stale</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Management-reported ARR against ARR computed from billing transactions at the end of{' '}
          {asOf}. Tolerance {formatRatio(reconciliation.tolerance)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Reported</dt>
            <dd className="font-medium">{formatMoney(reconciliation.reported?.value)}</dd>
            {reconciliation.reported ? (
              <dd className="text-xs">
                <EvidenceLink dealId={dealId} source={reconciliation.reported.ref} />
                {reconciliation.reported.period ? ` · ${reconciliation.reported.period}` : ''}
              </dd>
            ) : null}
          </div>
          <div>
            <dt className="text-muted-foreground">Calculated</dt>
            <dd className="font-medium">{formatMoney(reconciliation.calculated)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Delta (calculated − reported)</dt>
            <dd className="font-medium">{formatMoney(reconciliation.delta)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Delta %</dt>
            <dd className="font-medium">{formatRatio(reconciliation.deltaRatio)}</dd>
          </div>
        </dl>

        {reconciliation.explanation.length > 0 ? (
          <table className="w-full">
            <caption className="text-left text-muted-foreground">
              Excluded billing activity in {asOf}
            </caption>
            <thead className="text-left text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-1 font-medium">Exclusion</th>
                <th className="py-1 font-medium">Lines</th>
                <th className="py-1 font-medium">Amount</th>
                <th className="py-1 font-medium">Basis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {reconciliation.explanation.map((group) => (
                <tr key={group.reason}>
                  <td className="py-1">{EXCLUSION_LABELS[group.reason] ?? group.reason}</td>
                  <td className="py-1">{group.lines}</td>
                  <td className="py-1">
                    {formatMoney(group.amount)}
                    {group.unconvertedLines > 0 ? ` (+${group.unconvertedLines} unconverted)` : ''}
                  </td>
                  <td className="py-1">
                    {group.basis === 'ANNUALIZED_MRR' ? 'annualized' : 'as billed'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {approval.status === 'APPROVED' || approval.status === 'STALE' ? (
          <p className="text-muted-foreground">
            {approval.status === 'APPROVED'
              ? 'Approved'
              : 'Previously approved for different evidence'}{' '}
            on {approval.approvedAt?.slice(0, 10)}: “{approval.note}”
          </p>
        ) : null}

        {canDecide ? (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <form action={recordReconciliation.bind(null, dealId, asOf)}>
              <button
                type="submit"
                className="rounded-md border border-border px-3 py-1 font-medium"
              >
                Record reconciliation
              </button>
            </form>
            {approval.status !== 'APPROVED' ? (
              <form
                action={approveDifference.bind(null, dealId, asOf)}
                className="flex flex-col gap-2"
              >
                <input
                  type="hidden"
                  name="reconciliationId"
                  value={reconciliation.reconciliationId}
                />
                <label className="flex flex-col gap-1">
                  <span className="font-medium">Reviewer note</span>
                  <textarea
                    name="note"
                    required
                    minLength={3}
                    maxLength={2000}
                    rows={3}
                    className="rounded-md border border-border bg-background px-2 py-1"
                    placeholder="Why the difference is accepted, and how it should be treated."
                  />
                </label>
                <button
                  type="submit"
                  className="self-start rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground"
                >
                  Approve difference
                </button>
                <p className="text-xs text-muted-foreground">
                  Only a reviewer or the deal lead can approve.
                </p>
              </form>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default async function DealFinancesPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dealId } = await params;
  if (!isUuidParam(dealId)) notFound();
  const search = await searchParams;
  const asOf = parseMonthParam(search['asOf']);
  const outcome = typeof search['outcome'] === 'string' ? OUTCOMES[search['outcome']] : undefined;
  const [result, cohorts] = await Promise.all([
    metricsApi.summary(dealId, asOf),
    metricsApi.cohorts(dealId, asOf),
  ]);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Finances</h2>
        <p className="text-sm text-muted-foreground">
          Deterministic SaaS metrics from billing evidence. Every number links to the source records it was computed from.
        </p>
      </div>

      <form method="get" className="flex items-end gap-3 text-sm" aria-label="Choose as-of month">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">As of (month end)</span>
          <input
            type="month"
            name="asOf"
            defaultValue={result.kind === 'ok' ? result.data.report.asOfMonth : (asOf ?? '')}
            className="rounded-md border border-border bg-background px-2 py-1"
          />
        </label>
        <button type="submit" className="rounded-md border border-border px-3 py-1 font-medium">
          Apply
        </button>
      </form>

      {outcome ? (
        <p className="rounded-md border border-border px-3 py-2 text-sm">{outcome}</p>
      ) : null}

      {result.kind !== 'ok' ? (
        <ApiState result={result} />
      ) : result.data.report.series.length === 0 ? (
        <EmptyState
          title="No billing evidence"
          description="Connect a billing source and run a sync to compute metrics for this deal."
        />
      ) : (
        <>
          <section
            className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
            aria-label="Headline metrics"
          >
            {HEADLINE.map((key) => result.data.report.metrics.find((metric) => metric.key === key))
              .filter((metric): metric is MetricView => metric !== undefined)
              .map((metric) => (
                <MetricCard key={metric.key} dealId={dealId} metric={metric} />
              ))}
          </section>

          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader className="flex flex-row items-center gap-3">
                <IconTile accent="indigo">
                  <TrendingUp />
                </IconTile>
                <div>
                  <CardTitle>
                    <Term term="ARR" /> over time
                  </CardTitle>
                  <CardDescription>Month-end recurring revenue rebuilt from billing records.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <LineChart
                  label="ARR by month"
                  categories={result.data.report.series.map((point) => point.month)}
                  currency={result.data.report.baseCurrency}
                  series={[{ name: 'ARR', values: result.data.report.series.map((point) => point.arr.amount) }]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center gap-3">
                <IconTile accent="amber">
                  <PieChart />
                </IconTile>
                <div>
                  <CardTitle>Customer concentration</CardTitle>
                  <CardDescription>Share of ARR, largest customers.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <DonutChart
                  label="Share of ARR by customer"
                  slices={concentrationSlices(result.data.report.customers)}
                />
              </CardContent>
            </Card>
          </div>

          <Reconciliation dealId={dealId} data={result.data} />

          {result.data.draftFinding ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {result.data.draftFinding.title}
                  <Badge variant="draft">draft finding</Badge>
                  <Badge variant="danger">{result.data.draftFinding.severity.toLowerCase()}</Badge>
                </CardTitle>
                <CardDescription>
                  Proposed by {result.data.draftFinding.generatedBy} (deterministic, not AI).
                  Requires a human reviewer.
                  {result.data.draftFindingRecorded
                    ? ' Sent to findings review.'
                    : ' Record the reconciliation to send it to findings review.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <p>{result.data.draftFinding.summary}</p>
                <ul className="flex flex-col gap-1">
                  {result.data.draftFinding.evidence.map((cited) => (
                    <li key={cited.evidenceId} className="flex gap-2">
                      <Badge variant="evidence">cited</Badge>
                      <EvidenceLink dealId={dealId} source={{ ...cited }} />
                      <span className="text-muted-foreground">{cited.claim}</span>
                    </li>
                  ))}
                </ul>
                {result.data.draftFinding.omittedCitations > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {result.data.draftFinding.omittedCitations} more source records are listed on
                    the reconciliation.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {result.data.report.bridge ? (
            <Card>
              <CardHeader className="flex flex-row items-center gap-3">
                <IconTile accent="teal">
                  <BarChart3 />
                </IconTile>
                <div>
                  <CardTitle>
                    <Term term="MRR" /> bridge
                  </CardTitle>
                  <CardDescription>
                    {result.data.report.bridge.fromMonth} → {result.data.report.bridge.toMonth}: what moved recurring revenue.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <WaterfallChart
                  label="MRR bridge from opening to closing"
                  currency={result.data.report.bridge.opening.currency}
                  steps={[
                    { name: 'Opening', amount: result.data.report.bridge.opening.amount, kind: 'total' },
                    { name: 'New', amount: result.data.report.bridge.newMrr.amount, kind: 'step' },
                    { name: 'Expansion', amount: result.data.report.bridge.expansion.amount, kind: 'step' },
                    { name: 'Reactivation', amount: result.data.report.bridge.reactivation.amount, kind: 'step' },
                    { name: 'Contraction', amount: negate(result.data.report.bridge.contraction.amount), kind: 'step' },
                    { name: 'Churn', amount: negate(result.data.report.bridge.churned.amount), kind: 'step' },
                    { name: 'Closing', amount: result.data.report.bridge.closing.amount, kind: 'total' },
                  ]}
                />
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Show the numbers</summary>
                <table className="mt-2 w-full text-sm">
                  <tbody className="divide-y divide-border">
                    {(
                      [
                        ['Opening MRR', result.data.report.bridge.opening],
                        ['+ New', result.data.report.bridge.newMrr],
                        ['+ Expansion', result.data.report.bridge.expansion],
                        ['+ Reactivation', result.data.report.bridge.reactivation],
                        ['− Contraction', result.data.report.bridge.contraction],
                        ['− Churn', result.data.report.bridge.churned],
                        ['Closing MRR', result.data.report.bridge.closing],
                      ] as const
                    ).map(([label, value]) => (
                      <tr key={label}>
                        <td className="py-1">{label}</td>
                        <td className="py-1 text-right font-mono">{formatMoney(value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </details>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Customer concentration</CardTitle>
              <CardDescription>
                Largest customers by ARR at the end of {result.data.report.asOfMonth}.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 font-medium">Customer</th>
                    <th className="px-4 py-2 font-medium">
                      <Term term="ARR" />
                    </th>
                    <th className="px-4 py-2 font-medium">Share</th>
                    <th className="px-4 py-2 font-medium">Source lines</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.data.report.customers.slice(0, 10).map((customer) => (
                    <tr key={customer.customerId}>
                      <td className="px-4 py-2">
                        {customer.customerName ?? customer.customerId}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {customer.customerId}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono">{formatMoney(customer.arr)}</td>
                      <td className="px-4 py-2">{formatRatio(customer.share)}</td>
                      <td className="px-4 py-2 text-xs">
                        {customer.contributions.map((contribution) => (
                          <div key={contribution.ref.evidenceId}>
                            <EvidenceLink dealId={dealId} source={contribution.ref} />
                            {contribution.fx
                              ? ` · ${formatMoney(contribution.original)} at ${contribution.fx.rate} (${contribution.fx.source} ${contribution.fx.rateDate})`
                              : ''}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {cohorts.kind === 'ok' && cohorts.data.rows.length > 0 ? (
            <Card>
              <CardHeader className="flex flex-row items-center gap-3">
                <IconTile accent="indigo">
                  <Grid3x3 />
                </IconTile>
                <div>
                  <CardTitle>Revenue cohorts</CardTitle>
                  <CardDescription>
                    {cohorts.data.formula}. Darker means more revenue kept. The first row is the opening balance: those customers may
                    have started before the ledger&apos;s history.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 overflow-x-auto">
                <HeatmapChart
                  label="Revenue retention by cohort and month since start"
                  rows={cohorts.data.rows.map((row) => (row.openingBalance ? `≤ ${row.cohort}` : row.cohort))}
                  columns={Array.from({ length: Math.max(...cohorts.data.rows.map((row) => row.cells.length), 0) }, (_, index) => `M${index}`)}
                  cells={cohorts.data.rows.map((row) => row.cells.map((cell) => cell.revenueRetention))}
                  height={Math.max(220, cohorts.data.rows.length * 34 + 70)}
                />
                <details className="text-xs">
                  <summary className="cursor-pointer text-sm text-muted-foreground">Show the table</summary>
                <table className="mt-2 w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 font-medium">Cohort</th>
                      <th className="px-3 py-2 font-medium">Logos</th>
                      <th className="px-3 py-2 font-medium">
                        Starting <Term term="MRR" />
                      </th>
                      <th className="px-3 py-2 font-medium">Revenue retention by month</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {cohorts.data.rows.map((row) => (
                      <tr key={row.cohort}>
                        <td className="px-3 py-2 font-mono">
                          {row.openingBalance ? `≤ ${row.cohort}` : row.cohort}
                        </td>
                        <td className="px-3 py-2">{row.customers}</td>
                        <td className="px-3 py-2 font-mono">{formatMoney(row.startingMrr)}</td>
                        <td className="px-3 py-2 font-mono">
                          {row.cells.map((cell) => formatRatio(cell.revenueRetention)).join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </details>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Exclusions</CardTitle>
              <CardDescription>{result.data.report.inclusionPolicy}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {result.data.report.exclusions.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted-foreground">
                  No billing lines were excluded.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 font-medium">Source record</th>
                      <th className="px-4 py-2 font-medium">Reason</th>
                      <th className="px-4 py-2 font-medium">Detail</th>
                      <th className="px-4 py-2 font-medium">Monthly amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.data.report.exclusions.slice(0, 100).map((exclusion) => (
                      <tr key={`${exclusion.ref.evidenceId}-${exclusion.reason}`}>
                        <td className="px-4 py-2">
                          <EvidenceLink dealId={dealId} source={exclusion.ref} />
                        </td>
                        <td className="px-4 py-2">
                          {EXCLUSION_LABELS[exclusion.reason] ?? exclusion.reason}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{exclusion.detail}</td>
                        <td className="px-4 py-2 font-mono">
                          {formatMoney(exclusion.monthlyAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
