import { D, parseDecimal } from '../metrics/decimal';
import type { KeyExpense, TrendYear } from '../pnl/trend';
import { grouped, percent } from './common';
import type { PackHistory, PackMetric } from './metrics-types';
import { trendOf, PNL_LINE } from './pnl-trend';
import { MAX_CITED, type PackRule, type PackRuleEvidence, type PackRuleProposal } from './rule-types';
import { historyWindow, kindCoverage, longRunMetrics, recentRunCheck, RECENT_YEARS, type HistoryOptions, type HistoryWindow, type LongRunSeries } from './history-span';

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
  `Every complete year provided is read, up to 30 (T-185). Every pack expects ${RECENT_YEARS} fiscal years at least, or every year since the business started when it started later; a missing year, including a gap inside the history, is asked of the seller. Years before the business started are never asked for.`,
  'The trend checks and five-year figures read the latest five years, the period a buyer prices on; long-run growth, the worst year and through-cycle averages read the full history.',
] as const;

type Decimal = InstanceType<typeof D>;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const fiscal = (year: string) => `FY${year}`;

/** Rows whose field (trimmed, case-insensitive) is one of the values, or contains one when `contains` is set. */
export interface RowFilter {
  readonly field: string;
  readonly values: readonly string[];
  readonly contains?: boolean;
}

const matches = (filter: RowFilter | undefined) => (row: PackRuleEvidence) => {
  if (!filter) return true;
  const actual = (row.canonical[filter.field] ?? '').trim().toLowerCase();
  return filter.values.some((value) => (filter.contains ? actual.includes(value.toLowerCase()) : actual === value.toLowerCase()));
};

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
  /** Fields taken off the numerator's sum: net sales are gross sales less discounts and returns. */
  readonly numeratorLess?: readonly string[];
  readonly denominator?: readonly string[];
  /** Only rows whose field holds one of these values count in the numerator (a payer class's share, T-184b). */
  readonly numeratorWhere?: RowFilter;
  /** Only these rows count in the denominator; without it, every row of the year does. */
  readonly denominatorWhere?: RowFilter;
  /** Multiplies the value: 2 when the denominator sums opening and closing counts for subscriber-months. */
  readonly multiplier?: string;
  /** The ratio's complement, 1 − ratio: a repeat rate from new customers ÷ orders. */
  readonly complement?: boolean;
  /** Digits kept: money 2, ratios 4 (6 for rates under a percent), counts 0. */
  readonly scale?: number;
  readonly formula: string;
  /** A driver no sum expresses (ARR and retention from recurring revenue, T-184b): its years, computed. */
  readonly compute?: (evidence: readonly PackRuleEvidence[]) => readonly DriverYear[];
}

export interface PackHistorySpec {
  readonly drivers: readonly DriverSpec[];
  readonly keyExpenses: readonly KeyExpense[];
  /** The import (or imports) that hold the drivers, asked of the seller for missing years. */
  readonly driverImport: string | readonly string[];
  /** e.g. "Processor volume" → coverage label; and "processor volume history" in the ask. */
  readonly driverLabel: string;
  readonly driverWhat: string;
  /** The driver read over the full history for the worst year and a through-cycle average (T-185); default the first ratio driver. */
  readonly keyDriver?: string;
}

export interface DriverYear {
  readonly year: string;
  readonly value: string | null;
  readonly evidenceIds: readonly string[];
}

function driverYears(spec: DriverSpec, evidence: readonly PackRuleEvidence[]): { years: DriverYear[]; partial: string[] } {
  if (spec.compute) return { years: [...spec.compute(evidence)], partial: [] };
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
    const top = (counted: readonly PackRuleEvidence[]) => sum(counted, spec.numerator).minus(sum(counted, spec.numeratorLess ?? []));
    const counted = rows.filter(matches(spec.numeratorWhere));
    let value: Decimal | null;
    if (spec.mode === 'LAST') value = top((byMonth.get(`${year}-12`) ?? []).filter(matches(spec.numeratorWhere)));
    else if (spec.mode === 'SUM') value = top(counted);
    else {
      const denominator = sum(rows.filter(matches(spec.denominatorWhere)), spec.denominator ?? []);
      value = denominator.isZero() ? null : top(counted).div(denominator);
    }
    if (value && spec.complement) value = new D(1).minus(value);
    if (value && spec.multiplier) value = value.times(spec.multiplier);
    years.push({ year, value: value ? value.toFixed(scale) : null, evidenceIds: rows.map((row) => row.id) });
  }
  return { years, partial };
}

export interface PackHistoryResult {
  /** The years shown, oldest first: every year read (up to 30), and the expected years (T-185). */
  readonly years: readonly string[];
  /** The years expected: max(latest − 4, history start) … latest. */
  readonly expected: readonly string[];
  readonly window: HistoryWindow;
  /** The latest five years' P&L and drivers: what the trend rules and five-year figures read. */
  readonly operating: readonly TrendYear[];
  readonly drivers: ReadonlyMap<string, readonly DriverYear[]>;
  /** Every year read (T-185). */
  readonly allOperating: readonly TrendYear[];
  readonly allDrivers: ReadonlyMap<string, readonly DriverYear[]>;
  /** Each driver's coverage summary, for its History strip. */
  readonly driverCoverage: ReadonlyMap<string, string>;
  readonly table: PackHistory;
}

const asYearValue = (years: readonly TrendYear[], value: (year: TrendYear) => string | null) => years.map((year) => ({ year: year.year, value: value(year), evidenceIds: year.evidenceIds }));

/** The pack's history: the P&L and the drivers by year, side by side, with coverage and what to ask the seller. */
export function packHistory(spec: PackHistorySpec, evidence: readonly PackRuleEvidence[], options: HistoryOptions = {}): PackHistoryResult {
  const trend = trendOf(evidence, spec.keyExpenses);
  const read = new Map(spec.drivers.map((driver) => [driver.key, driverYears(driver, evidence).years] as const));
  const driverYearsRead = [...new Set([...read.values()].flatMap((years) => years.map((year) => year.year)))];
  const window = historyWindow([...trend.years.map((year) => year.year), ...driverYearsRead], options);
  const shownYear = (year: string) => window.years.includes(year);
  const recentYear = (year: string) => window.recent.includes(year);
  const allOperating = trend.years.filter((year) => shownYear(year.year));
  const allDrivers = new Map([...read.entries()].map(([key, years]) => [key, years.filter((year) => shownYear(year.year))] as const));
  const op = new Map(allOperating.map((year) => [year.year, year]));
  const row = (key: string, label: string, unit: 'MONEY' | 'RATIO' | 'COUNT', value: (year: string) => string | null | undefined) => ({ key, label, unit, values: window.years.map((year) => value(year) ?? null) });
  const operatingCover = kindCoverage('operating', 'Income and expenses', 'income statements', window, allOperating.map((year) => year.year));
  const driversCover = kindCoverage('drivers', spec.driverLabel, spec.driverWhat, window, driverYearsRead);
  const cover = [operatingCover, driversCover];
  const keyDriver = spec.drivers.find((driver) => driver.key === spec.keyDriver) ?? spec.drivers.find((driver) => driver.unit === 'RATIO');
  const longRun: LongRunSeries[] = [
    { key: 'revenue', label: 'Revenue', unit: 'MONEY', years: asYearValue(allOperating, (year) => year.revenue), figures: ['GROWTH', 'WORST'] },
    { key: 'ebitda', label: 'EBITDA', unit: 'MONEY', years: asYearValue(allOperating, (year) => year.ebitda), figures: ['GROWTH', 'WORST'] },
    { key: 'operating_margin', label: 'Operating margin (EBITDA)', unit: 'RATIO', years: asYearValue(allOperating, (year) => year.operatingMargin), figures: ['AVERAGE'] },
    ...(keyDriver ? [{ key: keyDriver.key, label: keyDriver.label, unit: keyDriver.unit, years: allDrivers.get(keyDriver.key) ?? [], figures: keyDriver.unit === 'RATIO' ? (['WORST', 'AVERAGE'] as const) : (['GROWTH', 'WORST'] as const) }] : []),
  ];
  const table: PackHistory = {
    version: PACK_HISTORY_VERSION,
    expectedYears: window.expected.length || RECENT_YEARS,
    years: window.years.map(fiscal),
    historyStartYear: window.start,
    recentYears: window.recent.map(fiscal),
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
      ...spec.drivers.map((driver) => row(driver.key, driver.label, driver.unit, (year) => allDrivers.get(driver.key)?.find((entry) => entry.year === year)?.value)),
    ],
    coverage: cover.map(({ key, label, present, missing, summary }) => ({ key, label, present, missing, summary })),
    asks: cover.flatMap((entry) => (entry.ask ? [{ needs: entry.key === 'operating' ? ['INCOME_STATEMENT'] : [spec.driverImport].flat(), note: entry.ask }] : [])),
    longRun: longRunMetrics(longRun, window),
    conventions: PACK_HISTORY_CONVENTIONS,
  };
  const driverCoverage = new Map(spec.drivers.map((driver) => [driver.key, kindCoverage(driver.key, driver.label, spec.driverWhat, window, (allDrivers.get(driver.key) ?? []).map((year) => year.year)).summary] as const));
  return {
    years: window.years,
    expected: window.expected,
    window,
    operating: allOperating.filter((year) => recentYear(year.year)),
    drivers: new Map([...allDrivers.entries()].map(([key, years]) => [key, years.filter((year) => recentYear(year.year))] as const)),
    allOperating,
    allDrivers,
    driverCoverage,
    table,
  };
}

/** A driver's years as a metric's History strip (every year read; the screen shows the last ten), with its coverage. */
export function withHistory(metric: PackMetric, result: PackHistoryResult, driverKey: string): PackMetric {
  const years = result.allDrivers.get(driverKey) ?? [];
  if (result.years.length === 0) return metric;
  return {
    ...metric,
    history: result.years.map((year) => ({ period: fiscal(year), value: years.find((entry) => entry.year === year)?.value ?? null })),
    coverage: result.driverCoverage.get(driverKey) ?? '',
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

// ---- The recent run against the long run (T-185) ----

/**
 * `<prefix>-recent-run`: the last five years' operating margin, or the pack's key ratio driver, averaging well above
 * the full history's (RECENT_RUN_POINTS, over RECENT_RUN_MIN_YEARS years or more). A −1 draft a person prices.
 */
export function recentRunRule(prefix: string, spec: PackHistorySpec): PackRule {
  const keyDriver = spec.drivers.find((driver) => driver.key === spec.keyDriver) ?? spec.drivers.find((driver) => driver.unit === 'RATIO');
  return {
    id: `${prefix}-recent-run`,
    version: '1',
    evidenceTypes: [PNL_LINE, ...new Set(spec.drivers.map((driver) => driver.evidenceType))],
    detect: ({ evidence }) => {
      const history = packHistory(spec, evidence);
      const margin = recentRunCheck('operating_margin', 'Operating margin (EBITDA)', asYearValue(history.allOperating, (year) => year.operatingMargin), 'FINANCIAL');
      const driver = keyDriver?.unit === 'RATIO' ? recentRunCheck(keyDriver.key, keyDriver.label, history.allDrivers.get(keyDriver.key) ?? [], 'OPERATIONAL') : null;
      return [margin, driver].filter((proposal): proposal is PackRuleProposal => proposal !== null);
    },
  };
}
