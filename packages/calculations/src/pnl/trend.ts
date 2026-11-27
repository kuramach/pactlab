import { D } from '../metrics/decimal';
import { pnlForPeriod, type PnlLineInput, type PnlLineKindInput, type PnlPeriod } from './pnl';

/**
 * The multi-year P&L trend (Kumar, 2026-11-26 — every pack): every fiscal year the imported P&L
 * covers, read as `pnl-1` reads one, side by side — revenue and its growth, gross and operating
 * margin, and the vertical's key expense ratios (a pack names them). Deterministic and decimal-only;
 * every figure names the rows (evidence items) it rests on. A single year still reads: the trend
 * simply has one year. Changing a rule is a new PNL_TREND_VERSION, never a silent edit.
 */
export const PNL_TREND_VERSION = 'pnl-trend-1';

/** An expense a pack watches against revenue, matched by the imported line's name. */
export interface KeyExpense {
  readonly key: string;
  readonly label: string;
  readonly pattern: RegExp;
}

export interface TrendRatio {
  readonly key: string;
  readonly label: string;
  /** Positive amount, in the pact's base currency. */
  readonly amount: string;
  /** Amount ÷ revenue; null when revenue is zero. */
  readonly ratio: string | null;
  readonly evidenceIds: readonly string[];
}

export interface TrendYear {
  readonly year: string;
  /** STATED: the file has the year as a column; ROLLED_UP: all twelve of its months are imported. */
  readonly basis: 'STATED' | 'ROLLED_UP';
  readonly revenue: string;
  readonly costOfRevenue: string;
  readonly operatingExpenses: string;
  readonly ebitda: string;
  /** (Revenue − cost of revenue) ÷ revenue. */
  readonly grossMargin: string | null;
  /** EBITDA ÷ revenue (the P&L reader's EBITDA: revenue less cost of revenue less operating expenses). */
  readonly operatingMargin: string | null;
  /** Revenue ÷ the previous year's revenue − 1; null for the first year, after a gap, or across a currency break. */
  readonly revenueGrowth: string | null;
  /** The currency the year's lines were declared in (T-170); null when undeclared (the pact's own). */
  readonly currency: string | null;
  readonly ratios: readonly TrendRatio[];
  readonly evidenceIds: readonly string[];
}

export interface PnlTrend {
  readonly version: typeof PNL_TREND_VERSION;
  readonly years: readonly TrendYear[];
  /** Years with some imported months but not all twelve: left out, never scaled up. */
  readonly partialYears: readonly string[];
  /** Years whose lines were declared in more than one currency: left out, never summed across currencies. */
  readonly mixedCurrencyYears: readonly string[];
  /** Where the declared currency changes between years: growth is not computed across it (T-170). */
  readonly currencyBreaks: readonly { readonly year: string; readonly from: string; readonly to: string }[];
  readonly conventions: readonly string[];
}

export const PNL_TREND_CONVENTIONS = [
  'Fiscal years are calendar years: a year the file states as a column is read as stated; otherwise all twelve of its months must be imported.',
  'A year with only some months imported is left out of the trend, never scaled up.',
  'Operating margin is EBITDA ÷ revenue, EBITDA being revenue less cost of revenue less operating expenses (other income and expense left out).',
  'A key expense is the sum of the imported cost lines whose names match it, as positive amounts.',
  'Years are compared like with like: nothing is converted between currencies; a year mixing currencies is left out, and growth is not computed across a change of currency.',
] as const;

type Decimal = InstanceType<typeof D>;
const ratioOf = (numerator: Decimal, denominator: Decimal) => (denominator.isZero() ? null : numerator.div(denominator).toFixed(4));
const YEAR = /^\d{4}$/;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The fiscal years an imported P&L covers in full, oldest first. */
export function fiscalYears(periods: readonly PnlPeriod[]): { years: PnlPeriod[]; partial: string[] } {
  const stated = new Set(periods.filter((period) => YEAR.test(period.period)).map((period) => period.period));
  const monthYears = new Set(
    periods.flatMap((period) => {
      const year = MONTH.exec(period.period)?.[1];
      return year ? [year] : [];
    }),
  );
  const years: PnlPeriod[] = [];
  const partial: string[] = [];
  for (const year of [...new Set([...stated, ...monthYears])].sort()) {
    const read = pnlForPeriod(periods, year);
    if (read) years.push(read);
    else partial.push(year);
  }
  return { years, partial };
}

export function pnlTrend(
  periods: readonly PnlPeriod[],
  keyExpenses: readonly KeyExpense[],
  /** The declared currency of each imported line (evidence id → ISO code); undeclared lines are the pact's. */
  currencyOf: ReadonlyMap<string, string> = new Map(),
): PnlTrend {
  const { years: read, partial } = fiscalYears(periods);
  const mixed: string[] = [];
  const years: { year: PnlPeriod; currency: string | null }[] = [];
  for (const year of read) {
    const declared = [...new Set(year.sources.flatMap((row) => (currencyOf.has(row.evidenceId) ? [currencyOf.get(row.evidenceId) as string] : [])))];
    if (declared.length > 1) mixed.push(year.period);
    else years.push({ year, currency: declared[0] ?? null });
  }
  const breaks: { year: string; from: string; to: string }[] = [];
  const out: TrendYear[] = [];
  for (const [index, { year, currency }] of years.entries()) {
    const revenue = new D(year.revenue);
    const before = index > 0 ? years[index - 1] : undefined;
    const previous = before?.year;
    const broken = before !== undefined && before.currency !== null && currency !== null && before.currency !== currency;
    if (broken) breaks.push({ year: year.period, from: before.currency as string, to: currency as string });
    const consecutive = !broken && previous && Number(previous.period) === Number(year.period) - 1;
    const ratios = keyExpenses.map((expense) => {
      const rows = year.sources.filter((row) => row.kind !== 'REVENUE' && row.kind !== 'OTHER_INCOME' && expense.pattern.test(row.account));
      const amount = rows.reduce((total, row) => total.plus(new D(row.amount).abs()), new D(0));
      return { key: expense.key, label: expense.label, amount: amount.toFixed(2), ratio: ratioOf(amount, revenue), evidenceIds: rows.map((row) => row.evidenceId) };
    });
    out.push({
      year: year.period,
      basis: year.rolledUpFrom ? 'ROLLED_UP' : 'STATED',
      revenue: year.revenue,
      costOfRevenue: year.costOfRevenue,
      operatingExpenses: year.operatingExpenses,
      ebitda: year.ebitda,
      grossMargin: ratioOf(revenue.minus(year.costOfRevenue), revenue),
      operatingMargin: ratioOf(new D(year.ebitda), revenue),
      revenueGrowth: consecutive && previous && !new D(previous.revenue).isZero() ? revenue.div(previous.revenue).minus(1).toFixed(4) : null,
      currency,
      ratios,
      evidenceIds: year.sources.map((row) => row.evidenceId),
    });
  }
  return { version: PNL_TREND_VERSION, years: out, partialYears: partial, mixedCurrencyYears: mixed, currencyBreaks: breaks, conventions: PNL_TREND_CONVENTIONS };
}

const LINE_KINDS = new Set<string>(['REVENUE', 'COGS', 'OPEX', 'OTHER_INCOME', 'OTHER_EXPENSE']);

/** The currency each imported line was declared in (T-170), for `pnlTrend`. */
export function pnlLineCurrencies(rows: readonly { readonly id: string; readonly canonical: Readonly<Record<string, string | null>> }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const currency = row.canonical['currency'];
    if (currency && /^[A-Z]{3}$/.test(currency)) out.set(row.id, currency);
  }
  return out;
}

/**
 * Imported P&L lines (`finance.pnl_line` canonical records) as the reader's input. When two imports
 * hold the same line for the same period, the newer row (the larger UUIDv7 id) is read, so a re-sent
 * statement never doubles a year. Lines without a confirmed kind, period or decimal amount are skipped.
 */
export function pnlLinesFromRecords(rows: readonly { readonly id: string; readonly canonical: Readonly<Record<string, string | null>> }[]): PnlLineInput[] {
  const latest = new Map<string, { id: string; line: PnlLineInput }>();
  for (const row of rows) {
    const kind = row.canonical['line_kind'];
    const period = row.canonical['month'];
    const amount = row.canonical['amount'];
    const account = row.canonical['account'] ?? '';
    if (!kind || !LINE_KINDS.has(kind) || !period || !amount || !/^-?\d+(\.\d+)?$/.test(amount)) continue;
    const key = `${account}|${period}`;
    const seen = latest.get(key);
    if (!seen || seen.id < row.id) latest.set(key, { id: row.id, line: { evidenceId: row.id, account, period, amount, kind: kind as PnlLineKindInput } });
  }
  return [...latest.values()].map((entry) => entry.line);
}
