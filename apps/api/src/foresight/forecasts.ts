import { foresightMetricsFor, macroAreaFor, type ForesightMetric, type PackId } from '@pactlab/domain';
import { projectWithForecasts } from '@pactlab/calculations';
import type { ForesightForecastsView, ForesightOutcomeView, ForesightSeriesView } from '@pactlab/contracts';

/** Five calendar years starting next year. */
export function forecastYears(now: Date): number[] {
  const first = now.getUTCFullYear() + 1;
  return [first, first + 1, first + 2, first + 3, first + 4];
}

/** A baseline older than this is refreshed in the background the next time Foresight is opened. */
export const BASELINE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** A refresh still RUNNING after this is treated as lost (process restarted) and may start again. */
export const BASELINE_STALE_RUN_MS = 10 * 60 * 1000;

export interface ForecastRow {
  metricKey: string;
  source: string;
  version: number;
  firstYear: number;
  values: { toString(): string }[];
  sourceName: string | null;
  sourceUrl: string | null;
  sourceAsOf: Date | null;
  rationale: string | null;
  modelId: string | null;
  createdBy: string | null;
  createdAt: Date;
}

/** The newest row per (metric, source), aligned to `years`; a series for other years is ignored. */
function latest(rows: readonly ForecastRow[], metricKey: string, source: 'EXTERNAL' | 'AI' | 'USER', years: readonly number[], names: ReadonlyMap<string, string>): ForesightSeriesView | null {
  const row = rows.filter((entry) => entry.metricKey === metricKey && entry.source === source && entry.firstYear === years[0]).sort((a, b) => b.version - a.version)[0];
  if (!row) return null;
  return {
    values: row.values.map((value) => value.toString()),
    version: row.version,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    asOf: row.sourceAsOf ? row.sourceAsOf.toISOString().slice(0, 10) : null,
    rationale: row.rationale,
    modelId: row.modelId,
    createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function outcome(metrics: readonly (ForesightMetric & { series: { values: string[]; used: ForesightOutcomeView['basis'][number]['used'] } })[], start: { amount: string; currency: string }, baseGrowth: string, years: readonly number[]): ForesightOutcomeView {
  const result = projectWithForecasts({
    startValue: start.amount,
    currency: start.currency,
    baseGrowth,
    metrics: metrics.map((metric) => ({ key: metric.key, label: metric.label, neutral: metric.neutral, growthPerPoint: metric.growthPerPoint, discountPerPoint: metric.discountPerPoint, values: metric.series.values })),
  });
  const firstYear = (years[0] ?? new Date().getUTCFullYear() + 1) - 1;
  return {
    path: result.path.map((entry) => ({ year: entry.year, calendarYear: firstYear + entry.year, value: entry.value })),
    drivers: [...result.drivers],
    basis: metrics.map((metric) => ({ key: metric.key, used: metric.series.used })),
  };
}

export function forecastsView(input: {
  pack: PackId | null;
  currency: string | null;
  baseline: { status: string; notes: string[]; finishedAt: Date | null; startedAt: Date } | null;
  rows: readonly ForecastRow[];
  names: ReadonlyMap<string, string>;
  start: { amount: string; currency: string; source: string } | null;
  baseGrowth: string;
  now: Date;
}): ForesightForecastsView {
  const years = forecastYears(input.now);
  const definitions = foresightMetricsFor(input.pack);
  const metrics = definitions.map((metric) => ({
    key: metric.key,
    label: metric.label,
    help: metric.help,
    neutral: metric.neutral,
    external: latest(input.rows, metric.key, 'EXTERNAL', years, input.names),
    ai: latest(input.rows, metric.key, 'AI', years, input.names),
    user: latest(input.rows, metric.key, 'USER', years, input.names),
  }));
  const neutral = (metric: ForesightMetric) => years.map(() => metric.neutral);
  const reference = definitions.map((metric, index) => {
    const view = metrics[index];
    const series = view?.ai ? { values: view.ai.values, used: 'AI' as const } : view?.external ? { values: view.external.values, used: 'EXTERNAL' as const } : { values: neutral(metric), used: 'NEUTRAL' as const };
    return { ...metric, series };
  });
  const mine = reference.map((metric, index) => {
    const user = metrics[index]?.user;
    return user ? { ...metric, series: { values: user.values, used: 'USER' as const } } : metric;
  });
  return {
    status: (input.baseline?.status as ForesightForecastsView['status'] | undefined) ?? 'NONE',
    notes: input.baseline?.notes ?? [],
    refreshedAt: input.baseline?.finishedAt ? input.baseline.finishedAt.toISOString() : null,
    years,
    area: input.currency ? macroAreaFor(input.currency) : null,
    metrics,
    outcomes: input.start
      ? {
          currency: input.start.currency,
          startValue: input.start.amount,
          startValueSource: input.start.source,
          baseGrowth: input.baseGrowth,
          engineVersion: 'foresight-forecast-1',
          reference: outcome(reference, input.start, input.baseGrowth, years),
          user: outcome(mine, input.start, input.baseGrowth, years),
        }
      : null,
  };
}
