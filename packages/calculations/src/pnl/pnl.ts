import { D, parseDecimal } from '../metrics/decimal';

/**
 * Reading an imported P&L (T-149, ADR 0038 `finance.pnl_line`): the statement each period adds up
 * to, the trailing figures valuation shows, and whether a filed figure agrees with it. Deterministic
 * and decimal-only: the same lines always give the same figures, and every figure names the rows
 * (evidence items) it rests on. Changing a rule is a new PNL_READER_VERSION, never a silent edit.
 */
export const PNL_READER_VERSION = 'pnl-1';

/** What an imported line is (the confirmed line kind; subtotals are never imported). */
export type PnlLineKindInput = 'REVENUE' | 'COGS' | 'OPEX' | 'OTHER_INCOME' | 'OTHER_EXPENSE';

export interface PnlLineInput {
  /** The evidence item the line was imported as: its citation. */
  readonly evidenceId: string;
  readonly account: string;
  /** `YYYY-MM` or `YYYY` as imported; anything else is its own period, never in a trailing figure. */
  readonly period: string;
  /** Decimal string in the pact's base currency. */
  readonly amount: string;
  readonly kind: PnlLineKindInput;
}

export type PnlGranularity = 'MONTH' | 'YEAR' | 'OTHER';

export interface PnlSourceRow {
  readonly evidenceId: string;
  readonly account: string;
  readonly period: string;
  readonly amount: string;
  readonly kind: PnlLineKindInput;
}

/** One period of the imported statement. Costs are positive amounts whichever sign the file used. */
export interface PnlPeriod {
  readonly period: string;
  readonly granularity: PnlGranularity;
  readonly revenue: string;
  readonly costOfRevenue: string;
  readonly operatingExpenses: string;
  readonly otherIncome: string;
  readonly otherExpense: string;
  /** Revenue less cost of revenue less operating expenses (other income and expense left out). */
  readonly ebitda: string;
  readonly netIncome: string;
  /** For a year rolled up from twelve imported months: those months. */
  readonly rolledUpFrom: readonly string[] | null;
  /** Every imported row the figures above add up. */
  readonly sources: readonly PnlSourceRow[];
}

/** How EBITDA is read from an imported P&L, in words a page or report prints beside it. */
export const PNL_EBITDA_BASIS =
  'Revenue less cost of revenue less operating expenses, from the imported lines (other income and expense left out). Depreciation or amortization booked inside operating expenses stays in; record it as a QoE adjustment.';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;
const fixed = (value: InstanceType<typeof D>) => value.toFixed(2);

export function granularityOf(period: string): PnlGranularity {
  return MONTH.test(period) ? 'MONTH' : YEAR.test(period) ? 'YEAR' : 'OTHER';
}

function totals(period: string, granularity: PnlGranularity, rows: readonly PnlSourceRow[], rolledUpFrom: readonly string[] | null): PnlPeriod {
  const sums = { REVENUE: new D(0), COGS: new D(0), OPEX: new D(0), OTHER_INCOME: new D(0), OTHER_EXPENSE: new D(0) };
  for (const row of rows) sums[row.kind] = sums[row.kind].plus(row.amount);
  // Costs written negative or positive are both costs: the sign of the period's total decides (as `pnlMonthlyTotals`).
  const cogs = sums.COGS.abs();
  const opex = sums.OPEX.abs();
  const otherExpense = sums.OTHER_EXPENSE.abs();
  const ebitda = sums.REVENUE.minus(cogs).minus(opex);
  return {
    period,
    granularity,
    revenue: fixed(sums.REVENUE),
    costOfRevenue: fixed(cogs),
    operatingExpenses: fixed(opex),
    otherIncome: fixed(sums.OTHER_INCOME),
    otherExpense: fixed(otherExpense),
    ebitda: fixed(ebitda),
    netIncome: fixed(ebitda.plus(sums.OTHER_INCOME).minus(otherExpense)),
    rolledUpFrom,
    sources: rows,
  };
}

/** The imported statement, period by period in period order. A line whose amount is not a decimal is refused. */
export function pnlPeriods(lines: readonly PnlLineInput[]): PnlPeriod[] {
  const byPeriod = new Map<string, PnlSourceRow[]>();
  for (const line of lines) {
    if (!parseDecimal(line.amount)) throw new Error(`P&L line ${line.evidenceId} has no decimal amount`);
    const rows = byPeriod.get(line.period) ?? [];
    rows.push({ evidenceId: line.evidenceId, account: line.account, period: line.period, amount: line.amount, kind: line.kind });
    byPeriod.set(line.period, rows);
  }
  return [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, rows]) => totals(period, granularityOf(period), [...rows].sort((x, y) => x.account.localeCompare(y.account) || x.evidenceId.localeCompare(y.evidenceId)), null));
}

const monthsOf = (year: string) => Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);

/**
 * The imported figures for a period as a person writes it: `2025-03`, `2025`, `FY2025` or `FY 2025`.
 * A year the file states directly is used as stated; otherwise all twelve of its months must be
 * imported to roll it up. Null when the P&L does not cover the period.
 */
export function pnlForPeriod(periods: readonly PnlPeriod[], written: string): PnlPeriod | null {
  const key = written.trim().toUpperCase().replace(/^FY\s*/, '');
  const direct = periods.find((period) => period.period === key);
  if (direct) return direct;
  if (!YEAR.test(key)) return null;
  const months = monthsOf(key).map((month) => periods.find((period) => period.period === month));
  if (months.some((month) => !month)) return null;
  const present = months as PnlPeriod[];
  return totals(key, 'YEAR', present.flatMap((month) => month.sources), present.map((month) => month.period));
}

export type TrailingPnl =
  | {
      readonly version: typeof PNL_READER_VERSION;
      /** TTM: the latest twelve consecutive imported months. FISCAL_YEAR: the latest year the file states. */
      readonly basis: 'TTM' | 'FISCAL_YEAR';
      readonly from: string;
      readonly to: string;
      readonly periods: readonly string[];
      readonly revenue: string;
      readonly ebitda: string;
      readonly ebitdaBasis: string;
      readonly lineCount: number;
      readonly evidenceIds: readonly string[];
    }
  | { readonly version: typeof PNL_READER_VERSION; readonly unavailable: string };

const previousMonth = (month: string) => {
  const [year = 0, number = 1] = month.split('-').map(Number);
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
};

/**
 * The trailing revenue and EBITDA valuation shows: the twelve months to the latest imported month
 * when all twelve are there, else the latest year the file states. Never a partial year scaled up.
 */
export function trailingPnl(periods: readonly PnlPeriod[]): TrailingPnl {
  const months = periods.filter((period) => period.granularity === 'MONTH');
  const years = periods.filter((period) => period.granularity === 'YEAR');
  let picked: PnlPeriod[] | null = null;
  let basis: 'TTM' | 'FISCAL_YEAR' = 'TTM';
  let missing: string[] = [];
  const latest = months.at(-1);
  if (latest) {
    const wanted: string[] = [];
    for (let month = latest.period; wanted.length < 12; month = previousMonth(month)) wanted.unshift(month);
    missing = wanted.filter((month) => !months.some((period) => period.period === month));
    if (missing.length === 0) picked = wanted.map((month) => months.find((period) => period.period === month) as PnlPeriod);
  }
  const latestYear = years.at(-1);
  if (!picked && latestYear) {
    picked = [latestYear];
    basis = 'FISCAL_YEAR';
  }
  if (!picked) {
    if (latest) return { version: PNL_READER_VERSION, unavailable: `Trailing twelve months need every month to ${latest.period}; ${missing.length} missing (${missing.join(', ')}).` };
    return { version: PNL_READER_VERSION, unavailable: 'No imported P&L with monthly (YYYY-MM) or yearly (YYYY) periods.' };
  }
  const chosen = picked;
  const sources = chosen.flatMap((period) => period.sources);
  const add = (pick: (period: PnlPeriod) => string) => fixed(chosen.reduce((total, period) => total.plus(pick(period)), new D(0)));
  return {
    version: PNL_READER_VERSION,
    basis,
    from: chosen[0]?.period ?? '',
    to: chosen.at(-1)?.period ?? '',
    periods: chosen.map((period) => period.period),
    revenue: add((period) => period.revenue),
    ebitda: add((period) => period.ebitda),
    ebitdaBasis: PNL_EBITDA_BASIS,
    lineCount: sources.length,
    evidenceIds: sources.map((row) => row.evidenceId),
  };
}

/** Rounding in either statement is not a disagreement: one currency unit, as the import's tie-out. */
export const PNL_AGREEMENT_TOLERANCE = '1';

/** Whether an imported figure and a filed one agree, and by how much they differ (imported less filed). */
export function comparePnlFigure(imported: string, filed: string): { agrees: boolean; difference: string } {
  const difference = new D(imported).minus(filed);
  return { agrees: difference.abs().lessThanOrEqualTo(PNL_AGREEMENT_TOLERANCE), difference: fixed(difference) };
}
