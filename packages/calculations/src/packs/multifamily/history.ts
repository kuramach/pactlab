import { D, parseDecimal } from '../../metrics/decimal';
import type { KeyExpense } from '../../pnl/trend';
import { PNL_LINE } from '../pnl-trend';
import type { PackHistory } from '../metrics-types';
import type { PackRuleEvidence } from '../rule-types';
import { historyWindow, kindCoverage, longRunMetrics, RECENT_YEARS, type HistoryOptions, type HistoryWindow } from '../history-span';
import { of, T12, type Decimal } from './shared';

/**
 * Five years of history for a multifamily property (T-183, ADR 0057): the operating statement by year and
 * occupancy and rent by year, read side by side, each figure naming the rows it rests on. Deterministic and
 * decimal-only. Less history is read as it is and stated ("2 of 5 years"); a missing year is an ask of the
 * seller, never a figure. Changing a rule is a new MULTIFAMILY_HISTORY_VERSION, never a silent edit.
 */
export const MULTIFAMILY_HISTORY_VERSION = 'multifamily-history-1';
/** Fiscal years every pack expects at least, plus the current year or the T-12 (ADR 0057); every year provided is read (T-185). */
export const HISTORY_YEARS = RECENT_YEARS;
export { yearRanges } from '../history-span';

export const OCCUPANCY = 'property.occupancy_period';
export const UNIT_SNAPSHOT = 'multifamily.unit_snapshot';

/** The multifamily expenses watched against income (shared P&L trend rules and the rent-growth check). */
export const MULTIFAMILY_KEY_EXPENSES: readonly KeyExpense[] = [
  { key: 'repairs', label: 'Repairs and maintenance', pattern: /repair|maintenance|turnover|make[- ]ready/i },
  { key: 'payroll', label: 'Payroll', pattern: /payroll|on-site staff|salar/i },
  { key: 'utilities', label: 'Utilities', pattern: /utilit|water|sewer|electric|trash/i },
  // A refund of premium is a one-off credit, never part of the insurance cost.
  { key: 'insurance', label: 'Insurance', pattern: /^(?!.*refund).*insurance/i },
  { key: 'taxes', label: 'Property taxes', pattern: /property tax|real estate tax/i },
];

export const MULTIFAMILY_HISTORY_CONVENTIONS = [
  'A year is labelled by the year it ends in. A P&L year the file states (a column such as FY2026) is read as stated; monthly P&L lines and the occupancy history are read in twelve-month years ending with the latest imported month; the T-12 is the latest such year when the P&L does not cover it.',
  'A year needs all twelve of its months (or, for rent-roll snapshots, one in each quarter); a part year is left out, never scaled up.',
  'Effective gross income is revenue on the P&L (rent less vacancy and concessions as the statement books them, plus other income); NOI is revenue less cost of revenue and operating expenses; the expense ratio is those expenses ÷ revenue.',
  'Occupancy for a year is occupied units ÷ units across its months (its average) and its lowest month (the low point); average in-place rent is weighted by occupied units; the trailing three-year vacancy is 1 − the mean of the last three years\' averages.',
  'Growth rates are compound annual rates between the first and the last year read; nothing is extrapolated to years not imported.',
  `Every complete year provided is read, up to 30 (T-185). Every pack expects ${HISTORY_YEARS} fiscal years at least, or every year since the business started (or the property was built or acquired) when that is later; a missing year, including a gap inside the history, is asked of the seller, and years before the start never are.`,
  'The trend checks and five-year figures read the latest five years; long-run growth, the worst year and through-cycle averages read the full history.',
] as const;

const fiscal = (year: string) => `FY${year}`;
const ratioOf = (numerator: Decimal, denominator: Decimal) => (denominator.isZero() ? null : numerator.div(denominator).toFixed(4));
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;
const amount = (value: string | null | undefined) => parseDecimal(value ?? null);

/** "2026-09" → the month `n` months earlier. */
export function monthsBefore(month: string, n: number): string {
  const [year = 0, number = 1] = month.split('-').map(Number);
  const index = year * 12 + (number - 1) - n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The twelve months of the window ending in `end`, oldest first. */
const windowOf = (end: string) => Array.from({ length: 12 }, (_, index) => monthsBefore(end, 11 - index));

// ---- The operating statement by year ----

export interface OperatingYear {
  readonly year: string;
  /** STATED: a year the P&L states; MONTHS: twelve monthly P&L lines; T12: the T-12 extract. */
  readonly basis: 'STATED' | 'MONTHS' | 'T12';
  readonly revenue: string;
  readonly expenses: string;
  readonly noi: string;
  readonly expenseRatio: string | null;
  readonly margin: string | null;
  readonly keyExpenses: readonly { readonly key: string; readonly label: string; readonly amount: string; readonly evidenceIds: readonly string[] }[];
  /** Cost lines booked as credits (negative), e.g. a refund: one-off items a reviewer checks. */
  readonly credits: readonly { readonly account: string; readonly amount: string; readonly evidenceId: string }[];
  readonly evidenceIds: readonly string[];
}

interface Line {
  readonly id: string;
  readonly account: string;
  readonly period: string;
  readonly amount: Decimal;
  readonly kind: string;
}

const KINDS = new Set(['REVENUE', 'COGS', 'OPEX', 'OTHER_INCOME', 'OTHER_EXPENSE']);

/** P&L lines in the pact's currency, the newer row read when two imports hold the same line and period. */
function pnlLines(evidence: readonly PackRuleEvidence[], currency: string): Line[] {
  const latest = new Map<string, Line>();
  for (const row of of(evidence, PNL_LINE)) {
    const kind = row.canonical['line_kind'] ?? '';
    const period = row.canonical['month'] ?? '';
    const value = amount(row.canonical['amount']);
    const declared = row.canonical['currency'];
    if (!KINDS.has(kind) || !value || !(MONTH.test(period) || YEAR.test(period)) || (declared && declared !== currency)) continue;
    const account = row.canonical['account'] ?? '';
    const key = `${account}|${period}`;
    const held = latest.get(key);
    if (!held || held.id < row.id) latest.set(key, { id: row.id, account, period, amount: value, kind });
  }
  return [...latest.values()];
}

function operatingYear(year: string, basis: OperatingYear['basis'], lines: readonly Line[]): OperatingYear {
  let revenue = new D(0);
  let cost = new D(0);
  for (const line of lines) {
    if (line.kind === 'REVENUE') revenue = revenue.plus(line.amount);
    if (line.kind === 'COGS' || line.kind === 'OPEX') cost = cost.plus(line.amount);
  }
  // Costs written negative or positive are costs: the sign of the year's total decides, as the P&L reader does.
  const expenses = cost.abs();
  const sign = cost.isNegative() ? -1 : 1;
  const costLines = lines.filter((line) => line.kind === 'COGS' || line.kind === 'OPEX');
  const noi = revenue.minus(expenses);
  return {
    year,
    basis,
    revenue: revenue.toFixed(2),
    expenses: expenses.toFixed(2),
    noi: noi.toFixed(2),
    expenseRatio: ratioOf(expenses, revenue),
    margin: ratioOf(noi, revenue),
    keyExpenses: MULTIFAMILY_KEY_EXPENSES.map((expense) => {
      const rows = costLines.filter((line) => expense.pattern.test(line.account));
      return { key: expense.key, label: expense.label, amount: rows.reduce((total, line) => total.plus(line.amount.times(sign)), new D(0)).toFixed(2), evidenceIds: rows.map((line) => line.id) };
    }),
    credits: costLines.filter((line) => line.amount.times(sign).isNegative()).map((line) => ({ account: line.account, amount: line.amount.times(sign).toFixed(2), evidenceId: line.id })),
    evidenceIds: lines.map((line) => line.id),
  };
}

/** Every operating year the evidence covers in full, oldest first, and the years left out as part years. */
export function operatingYears(evidence: readonly PackRuleEvidence[], currency: string): { years: OperatingYear[]; partial: string[] } {
  const lines = pnlLines(evidence, currency);
  const byYear = new Map<string, OperatingYear>();
  for (const year of [...new Set(lines.filter((line) => YEAR.test(line.period)).map((line) => line.period))]) {
    byYear.set(year, operatingYear(year, 'STATED', lines.filter((line) => line.period === year)));
  }
  const partial = new Set<string>();
  const monthly = lines.filter((line) => MONTH.test(line.period));
  const months = new Set(monthly.map((line) => line.period));
  const latest = [...months].sort().at(-1);
  if (latest) {
    for (let end = latest; [...months].some((month) => month <= end); end = monthsBefore(end, 12)) {
      const year = end.slice(0, 4);
      const window = windowOf(end);
      if (byYear.has(year)) continue;
      if (window.every((month) => months.has(month))) byYear.set(year, operatingYear(year, 'MONTHS', monthly.filter((line) => window.includes(line.period))));
      else partial.add(year);
    }
  }
  // The T-12 extract is the current year when the P&L does not hold it.
  const t12 = of(evidence, T12).filter((row) => MONTH.test(row.canonical['month'] ?? ''));
  const t12Months = [...new Set(t12.map((row) => row.canonical['month'] ?? ''))].sort();
  const t12End = t12Months.at(-1);
  if (t12End && windowOf(t12End).every((month) => t12Months.includes(month)) && !byYear.has(t12End.slice(0, 4))) {
    const rows = t12.filter((row) => windowOf(t12End).includes(row.canonical['month'] ?? ''));
    const sum = (field: string) => rows.reduce((total, row) => total.plus(amount(row.canonical[field]) ?? 0), new D(0));
    const revenue = sum('rental_income').plus(sum('other_income'));
    const expenses = sum('operating_expenses');
    const noi = sum('net_operating_income');
    byYear.set(t12End.slice(0, 4), {
      year: t12End.slice(0, 4),
      basis: 'T12',
      revenue: revenue.toFixed(2),
      expenses: expenses.toFixed(2),
      noi: noi.toFixed(2),
      expenseRatio: ratioOf(expenses, revenue),
      margin: ratioOf(noi, revenue),
      keyExpenses: [],
      credits: [],
      evidenceIds: rows.map((row) => row.id),
    });
    partial.delete(t12End.slice(0, 4));
  }
  for (const year of byYear.keys()) partial.delete(year);
  return { years: [...byYear.values()].sort((a, b) => a.year.localeCompare(b.year)), partial: [...partial].sort() };
}

// ---- Occupancy and rent by year ----

export interface OccupancyPoint {
  readonly period: string;
  readonly units: Decimal;
  readonly occupied: Decimal;
  /** Σ in-place rent of the occupied units, when stated. */
  readonly rentTotal: Decimal | null;
  readonly concessions: Decimal | null;
  readonly evidenceIds: readonly string[];
}

export interface OccupancyYear {
  readonly year: string;
  /** MONTHLY: twelve months; QUARTERLY: rent-roll snapshots in each quarter; STATED: an annual figure. */
  readonly basis: 'MONTHLY' | 'QUARTERLY' | 'STATED';
  /** Occupied ÷ units across the year. */
  readonly average: string;
  readonly low: string;
  readonly lowPeriod: string;
  readonly averageRent: string | null;
  readonly concessions: string | null;
  readonly evidenceIds: readonly string[];
}

const WHOLE_PROPERTY = /^(all|total|property|whole property|overall)$/i;

/** One point per month (or stated year): the whole-property row if there is one, else the unit types summed. */
function summaryPoints(evidence: readonly PackRuleEvidence[]): OccupancyPoint[] {
  const byPeriod = new Map<string, PackRuleEvidence[]>();
  for (const row of of(evidence, OCCUPANCY)) {
    const period = row.canonical['period'] ?? '';
    if (!MONTH.test(period) && !YEAR.test(period)) continue;
    byPeriod.set(period, [...(byPeriod.get(period) ?? []), row]);
  }
  return [...byPeriod.entries()].flatMap(([period, rows]) => {
    const whole = rows.filter((row) => WHOLE_PROPERTY.test((row.canonical['unit_type'] ?? '').trim()));
    const used = whole.length ? [whole.reduce((a, b) => (a.id > b.id ? a : b))] : rows;
    let units = new D(0);
    let occupied = new D(0);
    let rent: Decimal | null = new D(0);
    let concessions: Decimal | null = null;
    for (const row of used) {
      const u = amount(row.canonical['units']);
      const o = amount(row.canonical['occupied_units']);
      if (!u || !o) return [];
      units = units.plus(u);
      occupied = occupied.plus(o);
      const average = amount(row.canonical['average_rent']);
      rent = rent && average ? rent.plus(average.times(o)) : null;
      const given = amount(row.canonical['concessions']);
      if (given) concessions = (concessions ?? new D(0)).plus(given);
    }
    return units.isZero() ? [] : [{ period, units, occupied, rentTotal: rent, concessions, evidenceIds: used.map((row) => row.id) }];
  });
}

/** One point per rent-roll snapshot date: units counted, occupied units, and their in-place rent. */
function snapshotPoints(evidence: readonly PackRuleEvidence[]): OccupancyPoint[] {
  const byDate = new Map<string, PackRuleEvidence[]>();
  for (const row of of(evidence, UNIT_SNAPSHOT)) {
    const asOf = row.canonical['as_of'] ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) continue;
    byDate.set(asOf, [...(byDate.get(asOf) ?? []), row]);
  }
  return [...byDate.entries()].map(([asOf, rows]) => {
    const live = rows.filter((row) => row.canonical['status'] === 'occupied');
    return {
      period: asOf.slice(0, 7),
      units: new D(rows.length),
      occupied: new D(live.length),
      rentTotal: live.reduce((total, row) => total.plus(amount(row.canonical['in_place_rent']) ?? 0), new D(0)),
      concessions: null,
      evidenceIds: rows.map((row) => row.id),
    };
  });
}

function occupancyYear(year: string, basis: OccupancyYear['basis'], points: readonly OccupancyPoint[]): OccupancyYear {
  let units = new D(0);
  let occupied = new D(0);
  let rentOccupied = new D(0);
  let rent = new D(0);
  let concessions: Decimal | null = null;
  let low = points[0];
  for (const point of points) {
    units = units.plus(point.units);
    occupied = occupied.plus(point.occupied);
    if (point.rentTotal) {
      rent = rent.plus(point.rentTotal);
      rentOccupied = rentOccupied.plus(point.occupied);
    }
    if (point.concessions) concessions = (concessions ?? new D(0)).plus(point.concessions);
    if (low && point.occupied.div(point.units).lt(low.occupied.div(low.units))) low = point;
  }
  return {
    year,
    basis,
    average: occupied.div(units).toFixed(4),
    low: low ? low.occupied.div(low.units).toFixed(4) : '0.0000',
    lowPeriod: low?.period ?? year,
    averageRent: rentOccupied.isZero() ? null : rent.div(rentOccupied).toFixed(2),
    concessions: concessions ? concessions.toFixed(2) : null,
    evidenceIds: points.flatMap((point) => point.evidenceIds),
  };
}

/** Every occupancy year the evidence covers, oldest first, and the years left out as part years. */
export function occupancyYears(evidence: readonly PackRuleEvidence[]): { years: OccupancyYear[]; partial: string[] } {
  const summaries = summaryPoints(evidence);
  const byYear = new Map<string, OccupancyYear>();
  for (const point of summaries.filter((entry) => YEAR.test(entry.period))) byYear.set(point.period, occupancyYear(point.period, 'STATED', [point]));
  // Monthly figures win; a snapshot fills a month they leave empty.
  const monthly = new Map(summaries.filter((entry) => MONTH.test(entry.period)).map((entry) => [entry.period, entry]));
  const snapshots = new Map<string, OccupancyPoint>();
  for (const point of snapshotPoints(evidence)) if (!monthly.has(point.period)) snapshots.set(point.period, point);
  const all = [...monthly.keys(), ...snapshots.keys()].sort();
  const partial = new Set<string>();
  const latest = all.at(-1);
  if (latest) {
    for (let end = latest; all.some((month) => month <= end); end = monthsBefore(end, 12)) {
      const year = end.slice(0, 4);
      if (byYear.has(year)) continue;
      const window = windowOf(end);
      if (window.every((month) => monthly.has(month))) {
        byYear.set(year, occupancyYear(year, 'MONTHLY', window.map((month) => monthly.get(month) as OccupancyPoint)));
        continue;
      }
      const points = window.flatMap((month) => {
        const point = monthly.get(month) ?? snapshots.get(month);
        return point ? [point] : [];
      });
      const quarters = new Set(points.map((point) => Math.floor(window.indexOf(point.period) / 3)));
      if (quarters.size === 4) byYear.set(year, occupancyYear(year, 'QUARTERLY', points));
      else partial.add(year);
    }
  }
  return { years: [...byYear.values()].sort((a, b) => a.year.localeCompare(b.year)), partial: [...partial].filter((year) => !byYear.has(year)).sort() };
}

// ---- Growth and coverage ----

/** Compound annual growth between two years' figures; null when either is not positive or they are the same year. */
export function cagr(first: string | null, last: string | null, years: number): string | null {
  if (first === null || last === null || years <= 0) return null;
  const from = new D(first);
  const to = new D(last);
  if (!from.gt(0) || !to.gt(0)) return null;
  return to.div(from).pow(new D(1).div(years)).minus(1).toFixed(4);
}

const yearSpan = (first: string | undefined, last: string | undefined) => (first && last ? Number(last) - Number(first) : 0);

export interface HistoryCoverage {
  readonly key: 'operating' | 'occupancy';
  readonly label: string;
  /** Years read and years asked of the seller, as plain years. */
  readonly present: readonly string[];
  readonly missing: readonly string[];
  /** "FY2007–FY2026 (20 years)", "FY2025–FY2026 (2 of 5 years): ask the seller for FY2022–FY2024 …" (T-185). */
  readonly summary: string;
  readonly ask: string | null;
}

export interface MultifamilyHistory {
  readonly version: typeof MULTIFAMILY_HISTORY_VERSION;
  readonly expectedYears: number;
  /** The years expected: max(latest − 4, history start) … latest (T-185). */
  readonly expected: readonly string[];
  /** Every year shown, oldest first: every year read up to 30, and the expected years (T-185). */
  readonly years: readonly string[];
  readonly window: HistoryWindow;
  /** The latest five years: what the trend rules and five-year figures read. */
  readonly operating: readonly OperatingYear[];
  readonly occupancy: readonly OccupancyYear[];
  /** Every year read (T-185). */
  readonly operatingAll: readonly OperatingYear[];
  readonly occupancyAll: readonly OccupancyYear[];
  readonly partial: { readonly operating: readonly string[]; readonly occupancy: readonly string[] };
  readonly coverage: { readonly operating: HistoryCoverage; readonly occupancy: HistoryCoverage };
  readonly noiCagr: string | null;
  readonly revenueCagr: string | null;
  readonly rentCagr: string | null;
  /** Average rent growth year on year, by year (null for the first year or after a gap). */
  readonly rentGrowth: ReadonlyMap<string, string | null>;
  /** 1 − the mean of the last three occupancy years' averages. */
  readonly trailingVacancy: { readonly value: string | null; readonly years: readonly string[] };
}

function coverageOf(key: HistoryCoverage['key'], label: string, what: string, window: HistoryWindow, present: readonly string[]): HistoryCoverage {
  const cover = kindCoverage(key, label, what, window, present);
  return { key, label, present: cover.present.map((year) => year.slice(2)), missing: cover.missingYears, summary: cover.summary, ask: cover.ask };
}

export function multifamilyHistory(evidence: readonly PackRuleEvidence[], currency: string, options: HistoryOptions = {}): MultifamilyHistory {
  const operating = operatingYears(evidence, currency);
  const occupancy = occupancyYears(evidence);
  const window = historyWindow([...operating.years.map((year) => year.year), ...occupancy.years.map((year) => year.year)], options);
  const opAll = operating.years.filter((year) => window.years.includes(year.year));
  const occAll = occupancy.years.filter((year) => window.years.includes(year.year));
  const op = opAll.filter((year) => window.recent.includes(year.year));
  const occ = occAll.filter((year) => window.recent.includes(year.year));
  const firstOp = op[0];
  const lastOp = op.at(-1);
  const rented = occ.filter((year) => year.averageRent !== null);
  const rentGrowth = new Map<string, string | null>();
  for (const [index, year] of occAll.entries()) {
    const before = occAll[index - 1];
    rentGrowth.set(year.year, before && Number(before.year) === Number(year.year) - 1 && before.averageRent && year.averageRent ? new D(year.averageRent).div(before.averageRent).minus(1).toFixed(4) : null);
  }
  const lastThree = occ.slice(-3);
  const meanOccupancy = lastThree.length ? lastThree.reduce((total, year) => total.plus(year.average), new D(0)).div(lastThree.length) : null;
  return {
    version: MULTIFAMILY_HISTORY_VERSION,
    expectedYears: window.expected.length || HISTORY_YEARS,
    expected: window.expected,
    years: window.years,
    window,
    operating: op,
    occupancy: occ,
    operatingAll: opAll,
    occupancyAll: occAll,
    partial: { operating: operating.partial, occupancy: occupancy.partial },
    coverage: {
      operating: coverageOf('operating', 'Operating statements', 'operating statements', window, opAll.map((year) => year.year)),
      occupancy: coverageOf('occupancy', 'Occupancy and rent', 'occupancy and rent history', window, occAll.map((year) => year.year)),
    },
    noiCagr: cagr(firstOp?.noi ?? null, lastOp?.noi ?? null, yearSpan(firstOp?.year, lastOp?.year)),
    revenueCagr: cagr(firstOp?.revenue ?? null, lastOp?.revenue ?? null, yearSpan(firstOp?.year, lastOp?.year)),
    rentCagr: cagr(rented[0]?.averageRent ?? null, rented.at(-1)?.averageRent ?? null, yearSpan(rented[0]?.year, rented.at(-1)?.year)),
    rentGrowth,
    trailingVacancy: { value: meanOccupancy ? new D(1).minus(meanOccupancy).toFixed(4) : null, years: lastThree.map((year) => year.year) },
  };
}

/** The full history as the long-run series: revenue and NOI growth and worst years, the NOI margin and occupancy through the cycle. */
export function multifamilyLongRun(history: MultifamilyHistory) {
  const op = (value: (year: OperatingYear) => string | null) => history.operatingAll.map((year) => ({ year: year.year, value: value(year), evidenceIds: year.evidenceIds }));
  return longRunMetrics(
    [
      { key: 'revenue', label: 'Revenue', unit: 'MONEY', years: op((year) => year.revenue), figures: ['GROWTH', 'WORST'] },
      { key: 'noi', label: 'Net operating income', unit: 'MONEY', years: op((year) => year.noi), figures: ['GROWTH', 'WORST'] },
      { key: 'noi_margin', label: 'NOI margin', unit: 'RATIO', years: op((year) => year.margin), figures: ['AVERAGE'] },
      { key: 'occupancy', label: 'Occupancy (average)', unit: 'RATIO', years: history.occupancyAll.map((year) => ({ year: year.year, value: year.average, evidenceIds: year.evidenceIds })), figures: ['WORST', 'AVERAGE'] },
    ],
    history.window,
  );
}

/** What a missing operating or occupancy year is asked of the seller as: the income statement (a P&L import covers it) or the occupancy history. */
export const HISTORY_NEEDS = { operating: 'INCOME_STATEMENT', occupancy: 'MULTIFAMILY_OCCUPANCY' } as const;

/** The history as the generic table every pack's screen reads: years side by side, coverage, and what to ask the seller. */
export function historyTable(history: MultifamilyHistory): PackHistory {
  const years = history.years;
  const op = new Map(history.operatingAll.map((year) => [year.year, year]));
  const occ = new Map(history.occupancyAll.map((year) => [year.year, year]));
  const row = (key: string, label: string, unit: 'MONEY' | 'RATIO', value: (year: string) => string | null | undefined) => ({ key, label, unit, values: years.map((year) => value(year) ?? null) });
  const coverage = [history.coverage.operating, history.coverage.occupancy];
  return {
    version: history.version,
    expectedYears: history.expectedYears,
    years: years.map(fiscal),
    historyStartYear: history.window.start,
    recentYears: history.window.recent.map(fiscal),
    rows: [
      row('revenue', 'Revenue (effective gross income)', 'MONEY', (year) => op.get(year)?.revenue),
      row('expenses', 'Operating expenses', 'MONEY', (year) => op.get(year)?.expenses),
      row('noi', 'Net operating income', 'MONEY', (year) => op.get(year)?.noi),
      row('margin', 'NOI margin', 'RATIO', (year) => op.get(year)?.margin),
      row('expense_ratio', 'Expense ratio', 'RATIO', (year) => op.get(year)?.expenseRatio),
      row('occupancy', 'Occupancy (average)', 'RATIO', (year) => occ.get(year)?.average),
      row('occupancy_low', 'Occupancy (low point)', 'RATIO', (year) => occ.get(year)?.low),
      row('average_rent', 'Average in-place rent (monthly)', 'MONEY', (year) => occ.get(year)?.averageRent),
      row('rent_growth', 'Rent growth', 'RATIO', (year) => history.rentGrowth.get(year)),
    ],
    coverage: coverage.map((entry) => ({ key: entry.key, label: entry.label, present: entry.present.map(fiscal), missing: entry.missing.map(fiscal), summary: entry.summary })),
    asks: coverage.flatMap((entry) => (entry.ask ? [{ needs: [HISTORY_NEEDS[entry.key]], note: entry.ask }] : [])),
    longRun: multifamilyLongRun(history),
    conventions: MULTIFAMILY_HISTORY_CONVENTIONS,
  };
}
