/**
 * Deterministic, string-only value transforms. Money is never parsed into a
 * JavaScript number: amounts are rewritten as canonical decimal strings.
 */

export const DATE_FORMATS = ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD.MM.YYYY'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** `DOT_DECIMAL`: 1,234.56 · `COMMA_DECIMAL`: 1.234,56 (common in SAP exports from Europe). */
export const NUMBER_FORMATS = ['DOT_DECIMAL', 'COMMA_DECIMAL'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export const AMOUNT_UNITS = ['MAJOR', 'MINOR'] as const;
export type AmountUnit = (typeof AMOUNT_UNITS)[number];

const DATE_PATTERNS: Readonly<Record<DateFormat, RegExp>> = {
  'YYYY-MM-DD': /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/,
  'MM/DD/YYYY': /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: .*)?$/,
  'DD/MM/YYYY': /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: .*)?$/,
  'DD.MM.YYYY': /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?: .*)?$/,
};

const pad = (value: string) => value.padStart(2, '0');

/** Parse a date in the given format to `YYYY-MM-DD`, or null if it is not a real calendar date. */
export function parseDateValue(raw: string, format: DateFormat): string | null {
  const match = DATE_PATTERNS[format].exec(raw.trim());
  if (!match) return null;
  const [a = '', b = '', c = ''] = match.slice(1);
  const [year, month, day] =
    format === 'YYYY-MM-DD' ? [a, b, c] : format === 'MM/DD/YYYY' ? [c, a, b] : [c, b, a];
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

/** ISO 4217 minor-unit exponents that differ from 2. */
const MINOR_EXPONENT: Readonly<Record<string, number>> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, UYI: 0,
  VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0, BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

export function minorExponent(currency: string): number {
  return MINOR_EXPONENT[currency.toUpperCase()] ?? 2;
}

/** Strip leading zeros from an integer digit string, keeping one zero. */
const trimInt = (digits: string) => digits.replace(/^0+(?=\d)/, '');

/**
 * Normalize an amount to a canonical decimal string such as `-1234.5`.
 * Accepts grouping separators, a leading or trailing minus (SAP prints
 * `1.234,56-`) and accounting parentheses. Returns null for anything else.
 */
export function parseAmountValue(
  raw: string,
  options: { numberFormat: NumberFormat; unit: AmountUnit; currency: string | null; negate: boolean },
): string | null {
  let text = raw.trim().replace(/[\s']/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.endsWith('-')) {
    negative = !negative;
    text = text.slice(0, -1);
  } else if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }
  const [group, decimal] = options.numberFormat === 'DOT_DECIMAL' ? [',', '.'] : ['.', ','];
  const groupPattern = group === ',' ? /,/g : /\./g;
  const shape =
    options.numberFormat === 'DOT_DECIMAL'
      ? /^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/
      : /^(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/;
  if (!shape.test(text)) return null;
  const [integerPart = '0', fraction = ''] = text.replace(groupPattern, '').split(decimal);
  let integer = trimInt(integerPart);
  let frac = fraction;

  if (options.unit === 'MINOR') {
    if (frac !== '' || options.currency === null) return null;
    const exponent = minorExponent(options.currency);
    const padded = integer.padStart(exponent + 1, '0');
    integer = trimInt(padded.slice(0, padded.length - exponent));
    frac = padded.slice(padded.length - exponent);
  }
  frac = frac.replace(/0+$/, '');
  const body = frac ? `${integer}.${frac}` : integer;
  if (options.negate) negative = !negative;
  return negative && body !== '0' ? `-${body}` : body;
}

/** A plain non-negative decimal such as an interval count. */
export function parseDecimalValue(raw: string, numberFormat: NumberFormat): string | null {
  return parseAmountValue(raw, { numberFormat, unit: 'MAJOR', currency: null, negate: false });
}

const CURRENCY = /^[A-Za-z]{3}$/;

export function parseCurrencyValue(raw: string): string | null {
  const text = raw.trim();
  return CURRENCY.test(text) ? text.toUpperCase() : null;
}
