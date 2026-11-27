import { expectedInputLabel, type ExpectedInputId } from '@pactlab/domain';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { LineChart } from '../../_lib/charts';
import { formatDecimal, formatMoney, formatRatio } from '../../metrics/_lib/format';
import type { PackHistoryView, PackMetricsView } from '../../metrics/_lib/api';
import { AskSellerButton } from './ask-seller';
import type { MarketRentsOffer } from './market-rents';
import { MarketRentsButton } from './market-rents-button';

/** Multifamily's figures whose five years show as a History strip on Home (T-183); other packs mark theirs (`historyStrip`, T-184). */
export const HISTORY_STRIPS: ReadonlySet<string> = new Set(['noi_latest', 'occupancy_average', 'average_rent']);

/** A figure that waits on market rents (T-158): the card offers the retrieval, never an ask of the seller. */
export const MARKET_RENTS_NEED = 'MARKET_RENTS';

type Metric = PackMetricsView['metrics'][number];

/** What a missing figure needs, in plain words: "the rent roll and the unit inspections". */
export function needsLabel(needs: readonly string[]): string {
  // An import target or a document category (the income statement a P&L import covers).
  const names = needs.map((id) => {
    try {
      return expectedInputLabel(id as ExpectedInputId).toLowerCase();
    } catch {
      return id.toLowerCase();
    }
  });
  return names.length <= 1 ? `the ${names[0] ?? 'data'}` : `the ${names.slice(0, -1).join(', the ')} and the ${names.at(-1)}`;
}

/** Every import missing figures need, once, with the figures each would fill in. */
export function missingImports(metrics: readonly { label: string; value: string | null; needs?: readonly string[] | undefined }[]): { id: string; metrics: string[] }[] {
  const byImport = new Map<string, string[]>();
  for (const metric of metrics) {
    if (metric.value !== null) continue;
    for (const id of (metric.needs ?? []).filter((need) => need !== MARKET_RENTS_NEED)) byImport.set(id, [...(byImport.get(id) ?? []), metric.label]);
  }
  return [...byImport.entries()].map(([id, labels]) => ({ id, metrics: labels }));
}

/** The note sent with a request: which file, and which figures it fills in. */
export function requestNote(needs: readonly string[], metrics: readonly string[]): string {
  return `Pactlab needs ${needsLabel(needs)} to work out ${metrics.map((label) => label.toLowerCase()).join(', ')}. Please share it here.`;
}

/** Where a figure's inputs come from, when the pack has more than one source for it, with its cited records (T-158). */
/** The ask of a history with no start set also asks, once, when the business began (T-185). */
export const START_QUESTION = 'What’s the first year this business traded?';
export function withStartQuestion(note: string): string {
  return /started later\.$/.test(note) ? `${note} ${START_QUESTION}` : note;
}

export function MetricSource({ dealId, metric }: { dealId: string; metric: Pick<Metric, 'source' | 'evidenceIds'> }) {
  if (!metric.source) return null;
  const cited = metric.evidenceIds ?? [];
  return (
    <dd className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
      <span>Source: {metric.source}</span>
      {cited.map((id, index) => (
        <Link key={id} href={`/deals/${dealId}/evidence/${id}`} className="underline">
          {cited.length === 1 ? 'open estimate' : `estimate ${index + 1}`}
        </Link>
      ))}
    </dd>
  );
}

/**
 * The History strip (T-183): a figure's five years as a small line under it, with how much of the history it
 * rests on. Years not imported are gaps, never filled in. Drawn with the shared chart; the card is unchanged.
 */
/** The History strip shows the last ten years; the full history opens in the years table on Finances (T-185). */
export const STRIP_YEARS = 10;

export function HistoryStrip({ metric, currency }: { metric: Pick<Metric, 'label' | 'unit' | 'history' | 'coverage'>; currency: string }) {
  const all = metric.history ?? [];
  const points = all.slice(-STRIP_YEARS);
  if (points.length === 0 || points.every((point) => point.value === null)) return metric.coverage ? <dd className="text-xs text-muted-foreground">History: {metric.coverage}</dd> : null;
  return (
    <dd className="flex flex-col gap-1">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-text">History</span>
      <LineChart
        label={`${metric.label}, by year`}
        categories={points.map((point) => point.period)}
        series={[{ name: metric.label, values: points.map((point) => point.value) }]}
        format={metric.unit === 'MONEY' ? 'money' : metric.unit === 'RATIO' ? 'percent' : 'count'}
        currency={currency}
        height={72}
      />
      {metric.coverage ? <span className="text-xs text-muted-foreground">{metric.coverage}</span> : null}
      {all.length > points.length ? <span className="text-xs text-muted-foreground">The last {STRIP_YEARS} years shown; every year is in the years table on Finances.</span> : null}
    </dd>
  );
}

const cell = (unit: PackHistoryView['rows'][number]['unit'], value: string | null, currency: string) =>
  value === null ? '—' : unit === 'MONEY' ? formatMoney({ amount: value, currency }) : unit === 'RATIO' ? formatRatio(value) : formatDecimal(value);

/**
 * The years side by side (T-183, Finances): revenue, expenses, NOI, margin, occupancy and rent; a year not imported
 * shows a dash. Every year read (T-185): beyond about ten years the table scrolls sideways, the figure names staying put.
 */
export function HistoryTable({ history, currency }: { history: PackHistoryView; currency: string }) {
  if (history.years.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="overflow-x-auto" role="region" aria-label="The years side by side" tabIndex={0}>
        <table className="w-full min-w-max">
          <caption className="text-left text-muted-foreground">The years side by side, in {currency}</caption>
          <thead className="text-left text-muted-foreground">
            <tr className="border-b border-border">
              <th className="sticky left-0 bg-card py-1 pr-3 font-medium">Figure</th>
              {history.years.map((year) => (
                <th key={year} className="py-1 pl-3 text-right font-medium">
                  {year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {history.rows.map((row) => (
              <tr key={row.key}>
                <td className="sticky left-0 whitespace-nowrap bg-card py-1 pr-3">{row.label}</td>
                {row.values.map((value, index) => (
                  <td key={history.years[index] ?? index} className="py-1 pl-3 text-right whitespace-nowrap" data-numeric>
                    {cell(row.unit, value, currency)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {history.longRun && history.longRun.length > 0 ? <LongRunFigures figures={history.longRun} /> : null}
      <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {history.coverage.map((entry) => (
          <li key={entry.key}>
            {entry.label}: {entry.summary}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Over the full history (T-185): long-run growth, the worst year and how long it took to recover, and through-cycle
 * averages beside the last five years'. Built as the metric figures are; a figure that needs more years says so.
 */
export function LongRunFigures({ figures }: { figures: NonNullable<PackHistoryView['longRun']> }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">Over the full history</h4>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.key} className="flex flex-col gap-1 rounded-xl border border-navy/10 p-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-text">{figure.label}</dt>
            <dd className="text-lg font-extrabold tracking-tight" data-numeric>
              {figure.value === null ? '—' : formatRatio(figure.value)}
            </dd>
            <dd className="text-xs text-muted-foreground">{figure.value === null ? figure.unavailableReason : figure.formula}</dd>
            {figure.note ? <dd className="text-xs">{figure.note}</dd> : null}
            {figure.coverage ? <dd className="text-xs text-muted-foreground">{figure.coverage}</dd> : null}
          </div>
        ))}
      </dl>
    </div>
  );
}

const shown = (metric: Metric, currency: string) =>
  metric.value === null ? '—' : metric.unit === 'MONEY' ? formatMoney({ amount: metric.value, currency }) : metric.unit === 'RATIO' ? formatRatio(metric.value) : formatDecimal(metric.value);

/**
 * The pact's industry metrics on its Home (Kumar, 2026-11-25: "all the metrics in the Home page for the multi family
 * pact"): every figure with how it was worked out; a missing one says what it needs and, with a seller on the pact,
 * asks them for it in one click. Figures come from the metric engine, never a model.
 */
export function PropertyMetricsCard({
  dealId,
  report,
  canAsk,
  requested,
  marketRents = null,
}: {
  dealId: string;
  report: PackMetricsView;
  /** The buyer team, with a seller on the pact to ask. */
  canAsk: boolean;
  /** Import ids already asked for in an open request. */
  requested: ReadonlySet<string>;
  /** Market rents (T-158) when this viewer may check them: the card offers the retrieval. */
  marketRents?: MarketRentsOffer | null;
}) {
  if (report.metrics.length === 0) return null;
  const missing = missingImports(report.metrics);
  const unasked = missing.filter((entry) => !requested.has(entry.id));
  // Missing years of history (T-183): one ask per kind, unless a figure already asks for the same import.
  const historyAsks = (report.history?.asks ?? []).filter((ask) => !ask.needs.every((id) => missing.some((entry) => entry.id === id)));
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{report.calculator === 'multifamily-metrics' ? 'Property metrics' : 'Industry metrics'}</CardTitle>
          <CardDescription>
            From the imported data, in {report.currency}. Each figure shows how it is worked out.{' '}
            <Link href={`/deals/${dealId}/finances`} className="underline">
              Open in Finances
            </Link>
          </CardDescription>
        </div>
        {marketRents ? <MarketRentsButton dealId={dealId} offer={marketRents} /> : null}
        {canAsk && unasked.length > 1 ? (
          <AskSellerButton
            dealId={dealId}
            items={unasked.map((entry) => entry.id)}
            note={unasked.map((entry) => requestNote([entry.id], entry.metrics)).join('\n')}
            label={`Ask the seller for all ${unasked.length}`}
          />
        ) : null}
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {report.metrics.map((metric) => {
            const needsMarket = metric.value === null && (metric.needs ?? []).includes(MARKET_RENTS_NEED);
            const needs = metric.value === null ? (metric.needs ?? []).filter((need) => need !== MARKET_RENTS_NEED) : [];
            const asked = needs.length > 0 && needs.every((id) => requested.has(id));
            return (
              <div key={metric.key} className={`flex flex-col gap-1 rounded-xl border p-4 ${metric.value === null ? 'border-dashed border-amber/40 bg-amber/5' : 'border-navy/10'}`}>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-text">{metric.label}</dt>
                <dd className="text-2xl font-extrabold tracking-tight" data-numeric>
                  {shown(metric, report.currency)}
                </dd>
                {metric.value === null ? (
                  <dd className="flex flex-col gap-1.5 text-xs">
                    <span>{needs.length > 0 ? `Needs ${needsLabel(needs)}.` : needsMarket ? 'Needs market rents: Check rents against the market.' : metric.unavailableReason}</span>
                    {asked ? (
                      <span className="font-medium text-muted-foreground">Requested from the seller</span>
                    ) : canAsk && needs.length > 0 ? (
                      <AskSellerButton dealId={dealId} items={needs.filter((id) => !requested.has(id))} note={requestNote(needs, [metric.label])} label="Ask the seller for it" />
                    ) : needs.length > 0 ? (
                      <Link href={`/deals/${dealId}/sources/upload`} className="w-fit underline">
                        Import it
                      </Link>
                    ) : null}
                  </dd>
                ) : (
                  <>
                    <dd className="text-xs text-muted-foreground">
                      {metric.formula} · {metric.sourceCount} records
                    </dd>
                    <MetricSource dealId={dealId} metric={metric} />
                  </>
                )}
                {HISTORY_STRIPS.has(metric.key) || metric.historyStrip ? <HistoryStrip metric={metric} currency={report.currency} /> : null}
              </div>
            );
          })}
        </dl>
        {canAsk && historyAsks.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-dashed border-amber/40 bg-amber/5 p-4 text-sm">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-text">History</span>
            {historyAsks.map((ask) => (
              <div key={ask.note} className="flex flex-wrap items-center justify-between gap-2">
                <span>{ask.note}</span>
                {ask.needs.every((id) => requested.has(id)) ? (
                  <span className="font-medium text-muted-foreground">Requested from the seller</span>
                ) : (
                  <AskSellerButton dealId={dealId} items={ask.needs.filter((id) => !requested.has(id))} note={withStartQuestion(ask.note)} label="Ask the seller for them" />
                )}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
