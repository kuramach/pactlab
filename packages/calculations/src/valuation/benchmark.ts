import type Decimal from 'decimal.js';
import { D, money, parseDecimal } from '../metrics/decimal';
import { addMonths } from '../metrics/months';
import type { MoneyValue } from '../metrics/types';
import type { AskingBasis } from './asking';
import { canonicalJson, sha256Hex } from './canonical';
import type { BridgeAssumptions, ValuationResult } from './types';

/** Bumped whenever a statistic, position band, driver rule or rounding rule changes. */
export const BENCHMARK_VERSION = 'benchmark-1';

/** Below this many comparables the range is shown but flagged as thin. */
export const MIN_COMPARABLES = 3;

/** A driver within this many points (as a fraction) of the comparables' median is "similar". */
export const DRIVER_TOLERANCE = '0.02';

/** Multiples are reported to two decimal places; driver values to four. */
const MULTIPLE_SCALE = 2;
const RATIO_SCALE = 4;

export const COMPARABLE_ORIGINS = ['OWN_DEAL', 'ENTERED', 'PROVIDER', 'SYNTHETIC'] as const;
export type ComparableOrigin = (typeof COMPARABLE_ORIGINS)[number];

export const COMPARABLE_KINDS = ['PRECEDENT_TRANSACTION', 'PUBLIC_PEER', 'OWN_DEAL'] as const;
export type ComparableKind = (typeof COMPARABLE_KINDS)[number];

/** One comparable as stored: enterprise value and ARR in the same currency, drivers as fractions. */
export interface ComparableInput {
  readonly id: string;
  readonly name: string;
  readonly kind: ComparableKind;
  readonly origin: ComparableOrigin;
  readonly enterpriseValue: string;
  readonly arr: string;
  readonly arrGrowth: string | null;
  readonly nrr: string | null;
  readonly grr: string | null;
}

/** The target's own drivers, from its evidence (null when not measurable). */
export interface BenchmarkTarget {
  readonly arrGrowth: string | null;
  readonly nrr: string | null;
  readonly grr: string | null;
}

export interface BenchmarkInput {
  readonly comparables: readonly ComparableInput[];
  readonly target: BenchmarkTarget;
  /** The scenario's EV ÷ ARR multiple, when it has one. */
  readonly chosenMultiple: string | null;
  /** The asking price expressed as EV ÷ target ARR, when it can be. */
  readonly askingImpliedMultiple: string | null;
}

export type MultiplePosition = 'BELOW_RANGE' | 'LOW' | 'MID' | 'HIGH' | 'ABOVE_RANGE';

export interface MultiplePlacement {
  readonly multiple: string;
  /** Mid-rank percentile among the comparables, 0–100. */
  readonly percentile: number;
  readonly position: MultiplePosition;
}

export type DriverKey = 'ARR_GROWTH' | 'NRR' | 'GRR';
export type DriverComparison = 'STRONGER' | 'SIMILAR' | 'WEAKER';

export interface DriverResult {
  readonly key: DriverKey;
  readonly target: string | null;
  readonly median: string | null;
  /** Comparables that report this driver. */
  readonly reportedBy: number;
  /** Higher is better for every driver; null when either side is missing. */
  readonly comparison: DriverComparison | null;
}

export interface BenchmarkComparable extends ComparableInput {
  readonly multiple: string;
}

export interface MultipleStats {
  readonly min: string;
  readonly p25: string;
  readonly median: string;
  readonly p75: string;
  readonly max: string;
}

export interface MultipleBenchmark {
  readonly version: typeof BENCHMARK_VERSION;
  readonly count: number;
  readonly syntheticCount: number;
  readonly byOrigin: Readonly<Record<ComparableOrigin, number>>;
  /** False when fewer than MIN_COMPARABLES were available. */
  readonly sufficient: boolean;
  /** Null when there are no comparables. */
  readonly stats: MultipleStats | null;
  readonly chosen: MultiplePlacement | null;
  readonly asking: MultiplePlacement | null;
  readonly drivers: readonly DriverResult[];
  /** Comparables used, lowest multiple first. */
  readonly comparables: readonly BenchmarkComparable[];
  /** Identifies the exact comparable set, so a judgement can be checked against it later. */
  readonly comparableSetHash: string;
}

const multipleOf = (comparable: ComparableInput): Decimal => {
  const ev = parseDecimal(comparable.enterpriseValue);
  const arr = parseDecimal(comparable.arr);
  if (!ev || !arr || !ev.greaterThan(0) || !arr.greaterThan(0)) {
    throw new Error(`Comparable ${comparable.id} needs a positive enterprise value and ARR`);
  }
  return ev.dividedBy(arr);
};

/** Linear interpolation between closest ranks (the "type 7" quantile). `sorted` is ascending. */
function quantile(sorted: readonly Decimal[], p: string): Decimal {
  const h = new D(sorted.length - 1).times(p);
  const lower = h.floor().toNumber();
  const low = sorted[lower] as Decimal;
  const high = sorted[Math.min(lower + 1, sorted.length - 1)] as Decimal;
  return low.plus(high.minus(low).times(h.minus(lower)));
}

/** Mid-rank percentile: share strictly below plus half the ties, 0–100 rounded half-even. */
function percentileOf(sorted: readonly Decimal[], value: Decimal): number {
  const below = sorted.filter((m) => m.lessThan(value)).length;
  const equal = sorted.filter((m) => m.equals(value)).length;
  return new D(below).plus(new D(equal).dividedBy(2)).dividedBy(sorted.length).times(100).toDecimalPlaces(0).toNumber();
}

function place(sorted: readonly Decimal[], stats: Record<keyof MultipleStats, Decimal>, value: string | null): MultiplePlacement | null {
  const v = parseDecimal(value);
  if (!v || sorted.length === 0) return null;
  const position: MultiplePosition = v.lessThan(stats.min)
    ? 'BELOW_RANGE'
    : v.lessThan(stats.p25)
      ? 'LOW'
      : v.lessThanOrEqualTo(stats.p75)
        ? 'MID'
        : v.lessThanOrEqualTo(stats.max)
          ? 'HIGH'
          : 'ABOVE_RANGE';
  return { multiple: v.toFixed(MULTIPLE_SCALE), percentile: percentileOf(sorted, v), position };
}

function driver(key: DriverKey, target: string | null, values: readonly (string | null)[]): DriverResult {
  const reported = values.map(parseDecimal).filter((v): v is Decimal => v !== null).sort((a, b) => a.comparedTo(b));
  const median = reported.length > 0 ? quantile(reported, '0.5') : null;
  const t = parseDecimal(target);
  let comparison: DriverComparison | null = null;
  if (t && median) {
    const difference = t.minus(median);
    comparison = difference.abs().lessThanOrEqualTo(DRIVER_TOLERANCE) ? 'SIMILAR' : difference.greaterThan(0) ? 'STRONGER' : 'WEAKER';
  }
  return {
    key,
    target: t ? t.toFixed(RATIO_SCALE) : null,
    median: median ? median.toFixed(RATIO_SCALE) : null,
    reportedBy: reported.length,
    comparison,
  };
}

/** Hash of the comparable ids and the benchmark version: changes when the set changes. */
export function comparableSetHash(ids: readonly string[]): string {
  return sha256Hex(canonicalJson({ version: BENCHMARK_VERSION, ids: [...ids].sort() }));
}

/**
 * Place a valuation multiple and the asking price's implied multiple among
 * comparable EV ÷ ARR multiples, and compare the target's drivers with the
 * comparables' medians. Deterministic and decimal-only: the same comparables
 * and inputs always give the same answer. It describes; a person judges.
 */
export function benchmarkMultiple(input: BenchmarkInput): MultipleBenchmark {
  const withMultiples = input.comparables
    .map((comparable) => ({ comparable, multiple: multipleOf(comparable) }))
    .sort((a, b) => a.multiple.comparedTo(b.multiple) || a.comparable.id.localeCompare(b.comparable.id));
  const sorted = withMultiples.map((entry) => entry.multiple);
  const raw =
    sorted.length > 0
      ? {
          min: sorted[0] as Decimal,
          p25: quantile(sorted, '0.25'),
          median: quantile(sorted, '0.5'),
          p75: quantile(sorted, '0.75'),
          max: sorted[sorted.length - 1] as Decimal,
        }
      : null;
  const byOrigin = Object.fromEntries(COMPARABLE_ORIGINS.map((origin) => [origin, 0])) as Record<ComparableOrigin, number>;
  for (const { comparable } of withMultiples) byOrigin[comparable.origin] += 1;
  const comparables = input.comparables;

  return {
    version: BENCHMARK_VERSION,
    count: sorted.length,
    syntheticCount: byOrigin.SYNTHETIC,
    byOrigin,
    sufficient: sorted.length >= MIN_COMPARABLES,
    stats: raw
      ? {
          min: raw.min.toFixed(MULTIPLE_SCALE),
          p25: raw.p25.toFixed(MULTIPLE_SCALE),
          median: raw.median.toFixed(MULTIPLE_SCALE),
          p75: raw.p75.toFixed(MULTIPLE_SCALE),
          max: raw.max.toFixed(MULTIPLE_SCALE),
        }
      : null,
    chosen: raw ? place(sorted, raw, input.chosenMultiple) : null,
    asking: raw ? place(sorted, raw, input.askingImpliedMultiple) : null,
    drivers: [
      driver('ARR_GROWTH', input.target.arrGrowth, comparables.map((c) => c.arrGrowth)),
      driver('NRR', input.target.nrr, comparables.map((c) => c.nrr)),
      driver('GRR', input.target.grr, comparables.map((c) => c.grr)),
    ],
    comparables: withMultiples.map(({ comparable, multiple }) => ({ ...comparable, multiple: multiple.toFixed(MULTIPLE_SCALE) })),
    comparableSetHash: comparableSetHash(withMultiples.map(({ comparable }) => comparable.id)),
  };
}

/**
 * The asking price as an EV ÷ ARR multiple. An equity-value ask is moved to
 * enterprise value with the scenario's own bridge items (add debt and
 * debt-like items, subtract cash and the working-capital adjustment).
 */
export function askingImpliedMultiple(input: {
  readonly asking: { readonly amount: string; readonly currency: string; readonly basis: AskingBasis };
  readonly arr: MoneyValue;
  readonly bridge: BridgeAssumptions | null;
}): string | null {
  const amount = parseDecimal(input.asking.amount);
  const arr = parseDecimal(input.arr.amount);
  if (!amount || !arr || !arr.greaterThan(0) || input.asking.currency !== input.arr.currency) return null;
  let ev = amount;
  if (input.asking.basis === 'EQUITY_VALUE') {
    if (!input.bridge) return null;
    const part = (value: string) => parseDecimal(value) ?? new D(0);
    ev = amount
      .plus(part(input.bridge.debt))
      .plus(part(input.bridge.debtLikeItems))
      .minus(part(input.bridge.cash))
      .minus(part(input.bridge.workingCapitalAdjustment));
  }
  return ev.greaterThan(0) ? ev.dividedBy(arr).toFixed(MULTIPLE_SCALE) : null;
}

/** EV ÷ ARR in the same currency, two decimal places; null when it cannot be formed. */
export function evToArrMultiple(enterpriseValue: MoneyValue, arr: MoneyValue): string | null {
  const ev = parseDecimal(enterpriseValue.amount);
  const a = parseDecimal(arr.amount);
  if (!ev || !a || !a.greaterThan(0) || !ev.greaterThan(0) || enterpriseValue.currency !== arr.currency) return null;
  return ev.dividedBy(a).toFixed(MULTIPLE_SCALE);
}

/** Year-over-year ARR growth at `asOfMonth` from a monthly ARR series, four decimal places. */
export function arrGrowthFrom(series: readonly { readonly month: string; readonly arr: MoneyValue }[], asOfMonth: string): string | null {
  const now = parseDecimal(series.find((point) => point.month === asOfMonth)?.arr.amount);
  const before = parseDecimal(series.find((point) => point.month === addMonths(asOfMonth, -12))?.arr.amount);
  if (!now || !before || !before.greaterThan(0)) return null;
  return now.dividedBy(before).minus(1).toFixed(RATIO_SCALE);
}

/**
 * Enterprise value after accepted-finding price adjustments (escrows and
 * other holdbacks excluded): what a precedent from the firm's own deal is
 * recorded at, so its multiple reflects the risks it was priced with.
 */
export function riskAdjustedEnterpriseValue(result: ValuationResult): MoneyValue {
  let value = new D(result.enterpriseValue.amount);
  for (const line of result.bridge.lines) {
    if (line.kind === 'FINDING_ADJUSTMENT' && line.findingId !== null) value = value.plus(line.amount.amount);
  }
  return money(value, result.currency);
}
