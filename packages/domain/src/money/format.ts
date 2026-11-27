import { currencyMinorUnits } from './currencies';

/**
 * The one formatting entry point for money, numbers and dates (T-170, ADR 0056): web, site, emails and
 * generated documents all format here, through Intl, locale- and currency-aware.
 *
 * - Amounts are decimal strings and stay strings: Intl formats a numeric string exactly, so nothing
 *   passes through a JavaScript float.
 * - A currency is shown by its ISO code (`USD 1,234.50`, `1.234,50 EUR`), never a bare symbol, so a
 *   non-USD pact can never read as dollars. Symbols are an explicit choice (`display: 'symbol'`).
 * - Never more decimals than the currency's minor unit (JPY none, INR two), rounded half-even like
 *   storage; an amount keeps the decimals it has up to that.
 * - Grouping comes from the locale (en-IN gives lakh and crore), never hand-rolled.
 * - Nothing converts: a figure is shown in the currency it carries.
 */

export interface MoneyLike {
  readonly amount: string;
  readonly currency: string;
}

export interface MoneyFormatOptions {
  /** BCP 47 locale; when absent, the currency's own (INR → en-IN, otherwise en-US) until T-171 brings the reader's. */
  readonly locale?: string;
  /** `code` (default): `USD 1,234.50`. `symbol`: `$1,234.50`. */
  readonly display?: 'code' | 'symbol';
  /**
   * `exact` (default): the amount's own decimals, up to the minor unit. `trim`: the same, without trailing zeros
   * (`40000000.00` → `40,000,000`). `minor`: always the minor unit. `none`: whole units.
   */
  readonly fraction?: 'exact' | 'trim' | 'minor' | 'none';
  /** Compact notation (`USD 1.2M`) for charts. */
  readonly compact?: boolean;
}

/** The locale an amount is shown in when the reader has not chosen one. */
export function defaultMoneyLocale(currency: string): string {
  return currency.toUpperCase() === 'INR' ? 'en-IN' : 'en-US';
}

/** The app's default for numbers and dates until the reader's locale arrives (T-171). */
export const DEFAULT_LOCALE = 'en-US';

const DECIMAL = /^-?\d+(\.\d+)?$/;
const NBSP = /\u00a0/g;

type Numeric = Intl.StringNumericLiteral;

function fractionOf(amount: string): number {
  return /\.(\d+)$/.exec(amount)?.[1]?.length ?? 0;
}

function fractionDigits(amount: string, minor: number, fraction: MoneyFormatOptions['fraction']): { min: number; max: number } {
  if (fraction === 'none') return { min: 0, max: 0 };
  if (fraction === 'minor') return { min: minor, max: minor };
  if (fraction === 'trim') return { min: 0, max: minor };
  return { min: Math.min(fractionOf(amount), minor), max: minor };
}

/** `USD 1,234.50`; `—` when there is no amount. */
export function formatMoney(value: MoneyLike | null | undefined, options: MoneyFormatOptions = {}): string {
  return value ? formatAmount(value.amount, value.currency, options) : '—';
}

/** One amount in one currency. Anything that is not a decimal string is shown as given, never guessed. */
export function formatAmount(amount: string, currency: string, options: MoneyFormatOptions = {}): string {
  const code = currency.toUpperCase();
  const text = amount.trim();
  if (!DECIMAL.test(text)) return `${code} ${amount}`;
  const minor = currencyMinorUnits(code);
  const { min, max } = options.compact ? { min: 0, max: Math.min(2, minor) } : fractionDigits(text, minor, options.fraction);
  const formatter = new Intl.NumberFormat(options.locale ?? defaultMoneyLocale(code), {
    style: 'currency',
    currency: code,
    currencyDisplay: options.display ?? 'code',
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    roundingMode: 'halfEven',
    ...(options.compact ? { notation: 'compact' as const } : {}),
  });
  // The space between the code and the figure is a no-break space; a plain one keeps copy, search and PDFs simple.
  return formatter.format(text as Numeric).replace(NBSP, ' ');
}

/** A low–high range in one currency: `USD 1,000 – 3,000`; one amount when they are equal. */
export function formatMoneyRange(low: string, high: string, currency: string, options: MoneyFormatOptions = {}): string {
  const lowText = formatAmount(low, currency, options);
  if (low === high) return lowText;
  const text = high.trim();
  if (!DECIMAL.test(text)) return `${lowText} – ${high}`;
  const code = currency.toUpperCase();
  const { min, max } = fractionDigits(text, currencyMinorUnits(code), options.fraction);
  const highText = new Intl.NumberFormat(options.locale ?? defaultMoneyLocale(code), { minimumFractionDigits: min, maximumFractionDigits: max, roundingMode: 'halfEven' })
    .format(text as Numeric)
    .replace(NBSP, ' ');
  return `${lowText} – ${highText}`;
}

export interface NumberFormatOptions {
  readonly locale?: string;
  readonly maximumFractionDigits?: number;
  readonly minimumFractionDigits?: number;
  readonly compact?: boolean;
}

/** A count or a decimal string, grouped for the locale. Decimal strings keep their decimals unless capped. */
export function formatNumber(value: string | number | bigint, options: NumberFormatOptions = {}): string {
  const text = typeof value === 'string' ? value.trim() : value;
  if (typeof text === 'string' && !DECIMAL.test(text)) return String(value);
  // Numbers keep Intl's default of three decimals; decimal strings keep their own.
  const own = typeof text === 'string' ? fractionOf(text) : 3;
  const max = Math.min(options.maximumFractionDigits ?? own, 20);
  return new Intl.NumberFormat(options.locale ?? DEFAULT_LOCALE, {
    minimumFractionDigits: Math.min(options.minimumFractionDigits ?? 0, max),
    maximumFractionDigits: max,
    roundingMode: 'halfEven',
    ...(options.compact ? { notation: 'compact' as const } : {}),
  })
    .format(typeof text === 'string' ? (text as Numeric) : text)
    .replace(NBSP, ' ');
}

export interface DateFormatOptions {
  readonly locale?: string;
  /** Defaults to UTC: stored timestamps are UTC (CLAUDE.md). */
  readonly timeZone?: string;
}

const toDate = (value: string | Date) => (value instanceof Date ? value : new Date(value));

/** `26 Nov 2026` (en-GB) — `Nov 26, 2026` (en-US). */
export function formatDate(value: string | Date, options: DateFormatOptions & { style?: 'short' | 'medium' | 'long' } = {}): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, { dateStyle: options.style ?? 'medium', timeZone: options.timeZone ?? 'UTC' }).format(date);
}

/** Date and time; UTC unless a zone is given. */
export function formatDateTime(value: string | Date, options: DateFormatOptions = {}): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone: options.timeZone ?? 'UTC' }).format(date);
}

/** A `YYYY-MM` month: `Sep 2026` (`short`), `September 2026` (`long`), `Sep 26` (`2-digit`). */
export function formatMonth(month: string, options: DateFormatOptions & { style?: 'short' | 'long' | '2-digit' } = {}): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return month;
  const style = options.style ?? 'short';
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    month: style === 'long' ? 'long' : 'short',
    year: style === '2-digit' ? '2-digit' : 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}
