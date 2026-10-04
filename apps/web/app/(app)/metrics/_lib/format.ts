/**
 * Display formatting over decimal strings. Values are never parsed into
 * JavaScript numbers: grouping and percent shifts are pure string operations.
 */

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatDecimal(value: string): string {
  const match = DECIMAL.exec(value);
  if (!match) return value;
  const [, sign, whole = '0', fraction] = match;
  return `${sign}${group(whole)}${fraction ? `.${fraction}` : ''}`;
}

export function formatMoney(
  value: { amount: string; currency: string } | null | undefined,
): string {
  return value ? `${value.currency} ${formatDecimal(value.amount)}` : '—';
}

/** `'1.1201'` → `'112.01%'`; `null` → `'—'`. */
export function formatRatio(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const match = DECIMAL.exec(value);
  if (!match) return value;
  const [, sign, whole = '0', fraction = ''] = match;
  const padded = fraction.padEnd(2, '0');
  const integer = `${whole}${padded.slice(0, 2)}`.replace(/^0+(?=\d)/, '');
  const rest = padded.slice(2);
  return `${sign}${group(integer)}${rest ? `.${rest}` : ''}%`;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Accept only a `YYYY-MM` month from the query string. */
export function parseMonthParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && MONTH.test(value) ? value : undefined;
}

export const EXCLUSION_LABELS: Readonly<Record<string, string>> = {
  MISSING_CUSTOMER: 'Missing customer',
  MISSING_AMOUNT: 'Missing amount',
  INVALID_AMOUNT: 'Invalid amount',
  NON_POSITIVE_AMOUNT: 'Credit or zero line',
  MISSING_CURRENCY: 'Missing currency',
  INVALID_PERIOD: 'Missing or invalid service period',
  NON_RECURRING: 'One-time charge',
  UNSUPPORTED_INTERVAL: 'Unsupported billing interval',
  INVOICE_VOID: 'Void invoice',
  INVOICE_UNCOLLECTIBLE: 'Uncollectible invoice',
  INVOICE_DRAFT: 'Draft invoice',
  UNKNOWN_STATUS: 'Unknown invoice status',
  DUPLICATE_LINE: 'Duplicate line',
  NO_FX_RATE: 'No FX rate',
  STALE_FX_RATE: 'Stale FX rate',
  INVALID_FX_RATE: 'Invalid FX rate row',
};

export const RECONCILIATION_LABELS: Readonly<Record<string, string>> = {
  RECONCILED: 'Within tolerance',
  DIFFERENCE: 'Difference',
  NO_REPORTED_FIGURE: 'No management ARR for this month',
  REPORTED_VALUE_MISSING: 'Management ARR has no value',
  REPORTED_VALUE_UNCONVERTIBLE: 'Management ARR cannot be converted',
};
