import { D, parseDecimal } from '../metrics/decimal';
import type { KeyExpense, TrendYear } from '../pnl/trend';
import { grouped, percent } from './common';
import type { PackHistory, PackMetric } from './metrics-types';
import { trendOf, PNL_LINE } from './pnl-trend';
import { MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleProposal } from './rule-types';
import { HISTORY_YEARS, yearRanges } from './multifamily/history';

/**
 * Five years of history for any pack (T-184, ADR 0057), the generic form of what T-183 built on multifamily:
 * the imported P&L by fiscal year (read as `pnl-trend-1` reads it) and the pack's operating drivers by year,
 * from a period-series import the pack names (a month per row). Each driver is declarative: Σ some fields, or
 * Σ some fields ÷ Σ others, or the sum in the year's last month (a closing count). Deterministic, decimal-only;
 * every figure names the rows it rests on. Less history is read as it is and stated ("2 of 5 years"); a missing
 * year is an ask of the seller, never a figure. Changing a rule is a new PACK_HISTORY_VERSION.
 */
export const PACK_HISTORY_VERSION = 'pack-history-1';

export const PACK_HISTORY_CONVENTIONS = [
  'Fiscal years are calendar years, labelled by the year (FY2025). A P&L year the file states is read as stated; otherwise all twelve of its months must be imported.',
  'An operating driver for a year needs all twelve of its months in the export; a part year is left out, never scaled up. The current year shows as the trailing figures beside the history.',
  'A driver is a sum over the year (volume), a ratio of sums over the year (take rate, utilization), or the sum in the year\'s last month (a closing count).',
  'Growth rates are compound annual rates between the first and the last year read; nothing is extrapolated to years not imported.',
  `Every pack expects ${HISTORY_YEARS} fiscal years; a missing year is asked of the seller.`,
] as const;

type Decimal = InstanceType<typeof D>;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const fiscal = (year: string) => `FY${year}`;

/** Rows whose field (trimmed, case-insensitive) is one of the values. */
export interface RowFilter {
  readonly field: string;
  readonly values: readonly string[];
}

const matches = (filter: RowFilter | undefined) => (row: PackRuleEvidence) =>
  !filter || filter.values.some((value) => value.toLowerCase() === (row.canonical[filter.field] ?? '').trim().toLowerCase());

/** One operating driver read by year from a monthly export. */
export interface DriverSpec {
  readonly key: string;
  readonly label: string;
  readonly unit: 'MONEY' | 'RATIO' | 'COUNT';
  readonly evidenceType: string;
  /** The row's month field (`YYYY-MM`); default `month`. */
  readonly monthField?: string;
  /** SUM: Σ numerator; RATIO: Σ numerator ÷ Σ denominator; LAST: Σ numerator in the year's last month. */
  readonly mode: 'SUM' | 'RATIO' | 'LAST';
  readonly numerator: readonly string[];
  readonly denominator?: readonly string[];
  /** Only rows whose field holds one of these values count in the numerator (a payer class's share, T-184b). */
  readonly numeratorWhere?: RowFilter;
  /** Only these rows count in the denominator; without it, every row of the year does. */
  readonly denominatorWhere?: RowFilter;
  /** Multiplies the value: 2 when the denominator sums opening and closing counts for subscriber-months. */
  readonly multiplier?: string;
  /** Digits kept: money 2, ratios 4 (6 for rates under a percent), counts 0. */
  readonly scale?: number;
  readonly formula: string;
}

export interface PackHistorySpec {
  readonly drivers: readonly DriverSpec[];
  readonly keyExpenses: readonly KeyExpense[];
  /** The import that holds the drivers, asked of the seller for missing years. */
  readonly driverImport: string;
  /** e.g. "Processor volume" → coverage label; and "processor volume history" in the ask. */
  readonly driverLabel: string;
  readonly driverWhat: string;
}

export interface DriverYear {
  readonly year: string;
  readonly value: string | null;
  readonly evidenceIds: readonly string[];
}

function driverYears(spec: DriverSpec, evidence: readonly PackRuleEvidence[]): { years: DriverYear[]; partial: string[] } {
  const field = spec.monthField ?? 'month';
  const byMonth = new Map<string, PackRuleEvidence[]>();
  for (const row of evidence) {
    if (row.evidenceType !== spec.evidenceType) continue;
    const month = (row.canonical[field] ?? '').trim().slice(0, 7);
    if (!MONTH.test(month)) continue;
    byMonth.set(month, [...(byMonth.get(month) ?? []), row]);
  }
  const sum = (rows: readonly PackRuleEvidence[], fields: readonly string[]) =>
    rows.reduce((total, row) => fields.reduce((inner, name) => inner.plus(parseDecimal(row.canonical[name] ?? null) ?? 0), total), new D(0));
  const scale = spec.scale ?? (spec.unit === 'MONEY' ? 2 : spec.unit === 'RATIO' ? 4 : 0);
  const years: DriverYear[] = [];
  const partial: string[] = [];
  for (const year of [...new Set([...byMonth.keys()].map((month) => month.slice(0, 4)))].sort()) {
    const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
    if (!months.every((month) => byMonth.has(month))) {
      partial.push(year);
      continue;
    }
    const rows = months.flatMap((month) => byMonth.get(month) ?? []);
    const counted = rows.filter(matches(spec.numeratorWhere));
    let value: Decimal | null;
    if (spec.mode === 'LAST') value = sum((byMonth.get(`${year}-12`) ?? []).filter(matches(spec.numeratorWhere)), spec.numerator);
    else if (spec.mode === 'SUM') value = sum(counted, spec.numerator);
    else {
      const denominator = sum(rows.filter(matches(spec.denominatorWhere)), spec.denominator ?? []);
      value = denominator.isZero() ? null : sum(counted, spec.numerator).div(denominator);
    }
    if (value && spec.multiplier) value = value.times(spec.multiplier);
    years.push({ year, value: value ? value.toFixed(scale) : null, evidenceIds: rows.map((row) => row.id) });
  }
  return { years, partial };
}

export interface PackHistoryResult {
  /** The expected years, oldest first (the latest year read and the four before it). */
  readonly expected: readonly string[];
  readonly operating: readonly TrendYear[];
  readonly drivers: ReadonlyMap<string, readonly DriverYear[]>;
  readonly table: PackHistory;
}

function coverage(key: string, label: string, what: string, expected: readonly string[], present: readonly string[]) {
  const inRange = present.filter((year) => expected.includes(year));
  const missing = expected.filter((year) => !present.includes(year));
  const summary =
    inRange.length === 0
      ? `No ${label.toLowerCase()} imported yet: ask the seller for ${yearRanges(expected)} ${what}`
      : `${yearRanges(inRange)} (${inRange.length} of ${expected.length} years)${missing.length ? `: ask the seller for ${yearRanges(missing)} ${what}` : ''}`;
  return { key, label, present: inRange.map(fiscal), missing: missing.map(fiscal), summary, missingYears: missing };
}

/** The pack's history: the P&L and the drivers by year, side by side, with coverage and what to ask the seller. */
export function packHistory(spec: PackHistorySpec, evidence: readonly PackRuleEvidence[]): PackHistoryResult {
  const trend = trendOf(evidence, spec.keyExpenses);
  const drivers = new Map(spec.drivers.map((driver) => [driver.key, driverYears(driver, evidence).years] as const));
  const driverYearsRead = [...new Set([...drivers.values()].flatMap((years) => years.map((year) => year.year)))];
  const latest = [...trend.years.map((year) => year.year), ...driverYearsRead].sort().at(-1);
  const expected = latest ? Array.from({ length: HISTORY_YEARS }, (_, index) => String(Number(latest) - (HISTORY_YEARS - 1) + index)) : [];
  const operating = trend.years.filter((year) => expected.includes(year.year));
  const inExpected = new Map([...drivers.entries()].map(([key, years]) => [key, years.filter((year) => expected.includes(year.year))] as const));
  const op = new Map(operating.map((year) => [year.year, year]));
  const row = (key: string, label: string, unit: 'MONEY' | 'RATIO' | 'COUNT', value: (year: string) => string | null | undefined) => ({ key, label, unit, values: expected.map((year) => value(year) ?? null) });
  const cover = [
    coverage('operating', 'Income and expenses', 'income statements', expected, operating.map((year) => year.year)),
    coverage('drivers', spec.driverLabel, spec.driverWhat, expected, driverYearsRead),
  ];
  const table: PackHistory = {
    version: PACK_HISTORY_VERSION,
    expectedYears: HISTORY_YEARS,
    years: expected.map(fiscal),
    rows: [
      row('revenue', 'Revenue', 'MONEY', (year) => op.get(year)?.revenue),
      row('revenue_growth', 'Revenue growth', 'RATIO', (year) => op.get(year)?.revenueGrowth),
      row('gross_margin', 'Gross margin', 'RATIO', (year) => op.get(year)?.grossMargin),
      row('operating_margin', 'Operating margin (EBITDA)', 'RATIO', (year) => op.get(year)?.operatingMargin),
      ...spec.keyExpenses.map((expense) =>
        row(`expense_${expense.key}`, `${expense.label} ÷ revenue`, 'RATIO', (year) => {
          const ratio = op.get(year)?.ratios.find((entry) => entry.key === expense.key);
          return ratio && new D(ratio.amount).gt(0) ? ratio.ratio : null;
        }),
      ),
      ...spec.drivers.map((driver) => row(driver.key, driver.label, driver.unit, (year) => inExpected.get(driver.key)?.find((entry) => entry.year === year)?.value)),
    ],
    coverage: cover.map(({ missingYears: _missing, ...entry }) => entry),
    asks: cover
      .filter((entry) => entry.missingYears.length > 0)
      .map((entry) => ({
        needs: [entry.key === 'operating' ? 'INCOME_STATEMENT' : spec.driverImport],
        note: `Ask the seller for ${yearRanges(entry.missingYears)} ${entry.key === 'operating' ? 'income statements' : spec.driverWhat}.`,
      })),
    conventions: PACK_HISTORY_CONVENTIONS,
  };
  return { expected, operating, drivers: inExpected, table };
}

/** A driver's five years as a metric's History strip, with its coverage. */
export function withHistory(metric: PackMetric, result: PackHistoryResult, driverKey: string): PackMetric {
  const years = result.drivers.get(driverKey) ?? [];
  const present = years.map((year) => year.year);
  const missing = result.expected.filter((year) => !present.includes(year));
  if (result.expected.length === 0) return metric;
  const covered = present.length ? `${yearRanges(present)} (${present.length} of ${result.expected.length} years)` : `none of ${yearRanges(result.expected)}`;
  return {
    ...metric,
    history: result.expected.map((year) => ({ period: fiscal(year), value: years.find((entry) => entry.year === year)?.value ?? null })),
    coverage: missing.length ? `${covered}: ask the seller for ${yearRanges(missing)}` : covered,
    historyStrip: true,
  };
}

// ---- The driver trend rule ----

export interface DriverTrendCheck {
  readonly id: string;
  readonly driver: DriverSpec;
  /** The way the driver moving is a defect: DOWN (take rate, realization) or UP (loss rate, churn). */
  readonly adverse: 'DOWN' | 'UP';
  /** The smallest move first year to last that is a finding: points for ratios (0.002 = 0.2 points), a share for sums (0.1 = 10%). */
  readonly threshold: string;
  readonly domain: PackRuleProposal['domain'];
  /** What a reviewer checks, appended to the description. */
  readonly advice: string;
}

/** Fewest years a driver trend needs: two moves in the same direction. */
export const DRIVER_TREND_MIN_YEARS = 3;

const shown = (unit: DriverSpec['unit'], value: Decimal) => (unit === 'RATIO' ? percent(value) : grouped(value));

/**
 * A driver moving the adverse way every year across the history (three years or more), by the threshold or
 * more first to last: the defect a single year hides. Drafts a −1 finding citing the years' rows; a person
 * prices it. Years are consecutive; a gap ends the run that is read (the latest one).
 */
export function driverTrendRule(check: DriverTrendCheck, spec: PackHistorySpec): PackRule {
  return {
    id: check.id,
    version: '1',
    evidenceTypes: [check.driver.evidenceType, PNL_LINE],
    detect: ({ evidence }) => {
      const years = (packHistory(spec, evidence).drivers.get(check.driver.key) ?? []).filter((year) => year.value !== null);
      // The latest run of consecutive years.
      const run: DriverYear[] = [];
      for (const year of [...years].reverse()) {
        const next = run[0];
        if (next && Number(next.year) !== Number(year.year) + 1) break;
        run.unshift(year);
      }
      if (run.length < DRIVER_TREND_MIN_YEARS) return [];
      const values = run.map((year) => new D(year.value as string));
      const adverseEvery = values.slice(1).every((value, index) => (check.adverse === 'DOWN' ? value.lt(values[index] as Decimal) : value.gt(values[index] as Decimal)));
      const first = values[0] as Decimal;
      const last = values.at(-1) as Decimal;
      const move = check.driver.unit === 'RATIO' ? last.minus(first).abs() : first.isZero() ? new D(0) : last.minus(first).abs().div(first);
      if (!adverseEvery || move.lt(check.threshold)) return [];
      const span = `${fiscal(run[0]?.year ?? '')}–${fiscal(run.at(-1)?.year ?? '')}`;
      const path = run.map((year) => `${fiscal(year.year)} ${shown(check.driver.unit, new D(year.value as string))}`).join(', ');
      const size = check.driver.unit === 'RATIO' ? `${last.minus(first).times(100).abs().toFixed(2)} points` : percent(move);
      return [
        {
          key: `${check.driver.key}:${run[0]?.year}-${run.at(-1)?.year}`,
          domain: check.domain,
          title: `${check.driver.label} ${check.adverse === 'DOWN' ? 'falling' : 'rising'} every year, ${span}`,
          description: `From the imported history, year by year (${check.driver.formula}): ${path}. It ${check.adverse === 'DOWN' ? 'fell' : 'rose'} every year, ${size} first year to last; the latest year alone does not show it. ${check.advice}`,
          severity: 'MEDIUM',
          confidence: 'HIGH',
          direction: -1,
          pricedRisk: null,
          evidenceIds: [...new Set(run.flatMap((year) => year.evidenceIds))].slice(0, MAX_CITED),
        },
      ];
    },
  };
}
