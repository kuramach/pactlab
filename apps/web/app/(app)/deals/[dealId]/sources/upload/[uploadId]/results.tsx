import type { ImportResultsView } from '@pactlab/contracts';
import type { TargetDefinition } from '@pactlab/domain';
import Link from 'next/link';
import { formatDecimal, formatMoney, formatRatio } from '../../../../../metrics/_lib/format';
import type { MetricsSummaryView, PackMetricsView } from '../../../../../metrics/_lib/api';
import { AskSellerButton } from '../../../../_lib/ask-seller';
import { missingImports, needsLabel, requestNote } from '../../../../_lib/property-metrics';

const count = new Intl.NumberFormat('en-US');
/** A month as "Jan 2026"; a year (a statement by year) as itself. */
const monthName = (period: string) => (/^\d{4}$/.test(period) ? period : new Date(`${period}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }));

/** The subscription figures worth a first look, in order. */
const SUBSCRIPTION_HEADLINE = ['ARR', 'MRR', 'ACTIVE_CUSTOMERS', 'NRR', 'GRR', 'ARPA'];

export interface ShownMetric {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly how: string;
  /** The imports a missing figure needs (industry metrics only). */
  readonly needs?: readonly string[];
}

/** The metrics this data feeds, as figures a person can read, each with how it was worked out. */
export function shownMetrics(results: Pick<ImportResultsView, 'metrics'>, subscription: MetricsSummaryView | null, industry: PackMetricsView | null): ShownMetric[] {
  if (results.metrics === 'SUBSCRIPTION' && subscription) {
    return SUBSCRIPTION_HEADLINE.flatMap((key) => {
      const metric = subscription.report.metrics.find((entry) => entry.key === key);
      if (!metric) return [];
      const value =
        metric.value === null ? '—' : metric.unit === 'MONEY' ? formatMoney({ amount: metric.value, currency: metric.currency ?? subscription.report.baseCurrency }) : metric.unit === 'RATIO' ? formatRatio(metric.value) : formatDecimal(metric.value);
      return [{ key, label: metric.label, value, how: metric.value === null ? (metric.unavailableReason ?? 'Not enough data yet') : metric.formula }];
    });
  }
  if (results.metrics === 'INDUSTRY' && industry) {
    return industry.metrics.map((metric) => ({
      key: metric.key,
      label: metric.label,
      value:
        metric.value === null ? '—' : metric.unit === 'MONEY' ? formatMoney({ amount: metric.value, currency: industry.currency }) : metric.unit === 'RATIO' ? formatRatio(metric.value) : formatDecimal(metric.value),
      how: metric.value === null ? (metric.needs?.length ? `Needs ${needsLabel(metric.needs)}.` : (metric.unavailableReason ?? 'Not enough data yet')) : `${metric.formula} · ${count.format(metric.sourceCount)} records`,
      ...(metric.value === null && metric.needs?.length ? { needs: metric.needs } : {}),
    }));
  }
  return [];
}

/**
 * After an import: what Pactlab picked up, what it worked out from it and where it shows (Kumar, 2026-11-25: "it shd
 * show me what it picked up, what metrics it derived and how it will show"). Figures come from the metric engines
 * and code; nothing here is model text.
 */
export function ImportResults({
  dealId,
  uploadId,
  definition,
  results,
  metrics,
  metricsHidden,
  canDelete,
  justImported,
  checked = false,
  askSeller = false,
  requested = new Set<string>(),
}: {
  dealId: string;
  uploadId: string;
  definition: Pick<TargetDefinition, 'label'>;
  results: ImportResultsView;
  metrics: readonly ShownMetric[];
  /** The reader cannot see metrics (the seller's side): said, not hidden silently. */
  metricsHidden: boolean;
  canDelete: boolean;
  justImported: boolean;
  /** The pack's industry checks ran on the import (T-060). */
  checked?: boolean;
  /** The buyer team with a seller on the pact: missing figures can be asked of the seller (Kumar, 2026-11-25). */
  askSeller?: boolean;
  /** Import ids already asked for in an open request. */
  requested?: ReadonlySet<string>;
}) {
  const stillMissing = missingImports(metrics.map((metric) => ({ label: metric.label, value: metric.needs ? null : metric.value, needs: metric.needs }))).filter((entry) => !requested.has(entry.id));
  const { run } = results;
  const deleted = results.status === 'WITHDRAWN';
  return (
    <section aria-labelledby="picked-up" className="flex flex-col gap-4 rounded-lg border border-emerald-200 bg-emerald-50/40 px-4 py-4 text-sm">
      <div className="flex flex-col gap-1">
        <h3 id="picked-up" className="text-base font-semibold">
          What Pactlab picked up
        </h3>
        {justImported ? (
          <p role="status" className="text-emerald-900">
            {definition.label} imported: {count.format(run.recordsCreated)} new records, {count.format(run.recordsUnchanged)} already known.
            {checked ? ' Industry checks ran on them.' : ''}
          </p>
        ) : null}
        <p>
          {deleted
            ? `This import was deleted, so none of its ${count.format(run.recordsSeen)} records count any more.`
            : `${count.format(results.activeRecords)} ${definition.label.toLowerCase()} records from this file now count in the pact.`}
          {run.issuesCount > 0 ? ` ${count.format(run.issuesCount)} rows were left out because they could not be read.` : ''}
        </p>
      </div>

      {results.sample && results.sample.rows.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="font-medium">The first {results.sample.rows.length} records</span>
          <div className="overflow-x-auto rounded-md border border-border bg-background">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/60">
                <tr>
                  {results.sample.fields.map((field) => (
                    <th key={field.name} scope="col" className="whitespace-nowrap px-2 py-1 font-medium">
                      {field.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.sample.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, at) => (
                      <td key={at} className="whitespace-nowrap px-2 py-1" data-numeric>
                        {cell ?? <span className="text-muted-foreground">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : results.sample === null ? (
        <p className="text-muted-foreground">This file is about people, so only counts are shown here.</p>
      ) : null}

      {results.pnlMonths && results.pnlMonths.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="font-medium">What the P&amp;L adds up to, period by period</span>
          <span className="text-xs text-muted-foreground">Worked out from the lines you confirmed; the file’s own totals were checked against them, not imported.</span>
          <div className="overflow-x-auto rounded-md border border-border bg-background">
            <table className="w-full text-right text-xs" aria-label="P&L period by period">
              <thead className="bg-muted/60">
                <tr>
                  <th scope="col" className="px-2 py-1 text-left font-medium">
                    Period
                  </th>
                  {['Revenue', 'Cost of revenue', 'Gross profit', 'Operating expenses', 'Operating income', 'Net income'].map((label) => (
                    <th key={label} scope="col" className="whitespace-nowrap px-2 py-1 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.pnlMonths.map((month) => (
                  <tr key={month.month} data-numeric>
                    <th scope="row" className="px-2 py-1 text-left font-medium">
                      {monthName(month.month)}
                    </th>
                    {[month.revenue, month.costOfRevenue, month.grossProfit, month.operatingExpenses, month.operatingIncome, month.netIncome].map((value, at) => (
                      <td key={at} className="px-2 py-1">
                        {formatDecimal(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!deleted && results.metrics ? (
        <div className="flex flex-col gap-2">
          <span className="font-medium">Metrics worked out from it</span>
          {metricsHidden ? (
            <p className="text-muted-foreground">The buyer’s team sees the metrics this data feeds.</p>
          ) : metrics.length > 0 ? (
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map((metric) => (
                <div key={metric.key} className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{metric.label}</dt>
                  <dd className="text-lg font-semibold" data-numeric>
                    {metric.value}
                  </dd>
                  <dd className="text-xs text-muted-foreground">{metric.how}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-muted-foreground">The metrics are still being worked out; open Finances to see them.</p>
          )}
          {!metricsHidden && stillMissing.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-amber/40 bg-amber/5 px-3 py-2">
              <span>
                Some figures still need {needsLabel(stillMissing.map((entry) => entry.id))}.
              </span>
              {askSeller ? (
                <AskSellerButton dealId={dealId} items={stillMissing.map((entry) => entry.id)} note={stillMissing.map((entry) => requestNote([entry.id], entry.metrics)).join('\n')} label="Ask the seller for it" />
              ) : (
                <Link href={`/deals/${dealId}/sources/upload`} className="underline">
                  Import it
                </Link>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {!deleted ? (
        <div className="flex flex-col gap-1">
          <span className="font-medium">Where it shows</span>
          <ul className="flex list-disc flex-col gap-0.5 pl-5">
            {results.metrics && !metricsHidden ? (
              <li>
                <Link href={`/deals/${dealId}/finances`} className="underline">
                  Finances
                </Link>
                : the metrics above, with every input traceable to these records.
              </li>
            ) : null}
            {results.pnlMonths ? <li>Quality of earnings and valuation will read this P&amp;L once they are switched on for it.</li> : null}
            <li>
              <Link href={`/deals/${dealId}/evidence`} className="underline">
                Evidence
              </Link>
              : every record, with the file and row it came from.
            </li>
            {results.findings !== null ? (
              <li>
                <Link href={`/deals/${dealId}/findings`} className="underline">
                  Findings
                </Link>
                : {results.findings === 0 ? 'none cite it yet; run the industry checks there to draft some.' : `${count.format(results.findings)} cite these records.`}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {!deleted && canDelete ? (
        <p className="text-muted-foreground">
          Doesn’t look right?{' '}
          <Link href={`/deals/${dealId}/sources/upload/${uploadId}?delete=1#delete`} className="font-medium text-foreground underline">
            Delete it and import again
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}
