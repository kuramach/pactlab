import type Decimal from 'decimal.js';
import { D, money, parseDecimal } from './decimal';
import type { FxTable } from './fx';
import { addMonths, isDate, monthEnd, monthOf } from './months';
import {
  METRICS_ENGINE_VERSION,
  type Exclusion,
  type ExclusionReason,
  type MoneyValue,
  type RevenueLineInput,
  type SourceRef,
} from './types';

/** Months per billing interval. Shorter intervals are not normalized in this version. */
const INTERVAL_MONTHS: Readonly<Record<string, number>> = { month: 1, year: 12 };

/** Invoice states that count as contracted recurring revenue. */
const INCLUDED_STATUSES = new Set(['paid', 'open']);
const STATUS_EXCLUSIONS: Readonly<Record<string, ExclusionReason>> = {
  void: 'INVOICE_VOID',
  uncollectible: 'INVOICE_UNCOLLECTIBLE',
  draft: 'INVOICE_DRAFT',
};

export const LEDGER_INCLUSION_POLICY =
  'Recurring (monthly or annual) invoice lines on paid or open invoices with a customer, ' +
  'currency, positive amount and valid service period. Void, uncollectible, draft, one-time ' +
  'and duplicate lines are excluded and listed with their reason.';

/** One included invoice line, normalized to a monthly recurring amount in its own currency. */
export interface LedgerEntry {
  readonly ref: SourceRef;
  readonly lineId: string;
  readonly customerId: string;
  readonly customerName: string | null;
  readonly currency: string;
  readonly monthlyAmount: Decimal;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** First and last month whose month-end falls inside the service period, or null. */
  readonly firstMonth: string | null;
  readonly lastMonth: string | null;
}

/** An excluded line that still has a computable service window (for gap explanations). */
export interface ExcludedLine extends Exclusion {
  readonly currency: string | null;
  readonly monthly: Decimal | null;
  readonly firstMonth: string | null;
  readonly lastMonth: string | null;
}

export interface RevenueLedger {
  readonly version: string;
  readonly entries: readonly LedgerEntry[];
  readonly exclusions: readonly ExcludedLine[];
  /** First month any included line is active. */
  readonly firstMonth: string | null;
}

/** Month-end measurement: a line counts in month M when start ≤ end-of-M < end. */
function activeMonths(start: string, end: string): { first: string | null; last: string | null } {
  const first = monthOf(start);
  if (monthEnd(first) >= end) return { first: null, last: null };
  return { first, last: addMonths(monthOf(end), -1) };
}

export function isActiveIn(
  window: { firstMonth: string | null; lastMonth: string | null },
  month: string,
) {
  return (
    window.firstMonth !== null &&
    window.lastMonth !== null &&
    window.firstMonth <= month &&
    month <= window.lastMonth
  );
}

/**
 * Normalize invoice lines into a revenue ledger. Deterministic: the same
 * lines (in any order) always produce the same ledger and exclusions.
 */
export function buildRevenueLedger(lines: readonly RevenueLineInput[]): RevenueLedger {
  const sorted = [...lines].sort(
    (a, b) => a.lineId.localeCompare(b.lineId) || a.ref.evidenceId.localeCompare(b.ref.evidenceId),
  );
  const entries: LedgerEntry[] = [];
  const exclusions: ExcludedLine[] = [];
  const seen = new Map<string, string>();

  for (const line of sorted) {
    const currency = line.currency && /^[A-Z]{3}$/.test(line.currency) ? line.currency : null;
    const amount = parseDecimal(line.amount);
    const validPeriod =
      isDate(line.periodStart) && isDate(line.periodEnd) && line.periodStart <= line.periodEnd;
    const interval = line.interval ?? null;
    const intervalMonths = interval ? INTERVAL_MONTHS[interval] : undefined;
    const count = line.intervalCount === null ? new D(1) : parseDecimal(line.intervalCount);
    const recurring =
      interval !== null &&
      intervalMonths !== undefined &&
      count !== null &&
      count.isInteger() &&
      count.greaterThan(0);
    const monthly =
      amount && recurring
        ? amount.dividedBy(count.times(intervalMonths))
        : interval === null
          ? amount
          : null;
    const window =
      validPeriod && line.periodStart && line.periodEnd
        ? line.periodStart === line.periodEnd
          ? { first: monthOf(line.periodStart), last: monthOf(line.periodStart) }
          : activeMonths(line.periodStart, line.periodEnd)
        : { first: null, last: null };

    const exclude = (reason: ExclusionReason, detail: string) =>
      exclusions.push({
        ref: line.ref,
        reason,
        detail,
        customerId: line.customerId,
        month: null,
        monthlyAmount: monthly && currency ? money(monthly, currency) : null,
        currency,
        monthly,
        firstMonth: window.first,
        lastMonth: window.last,
      });

    if (!line.customerId) exclude('MISSING_CUSTOMER', 'Line has no customer id');
    else if (!line.currency) exclude('MISSING_CURRENCY', 'Line has no currency');
    else if (!currency) exclude('MISSING_CURRENCY', 'Currency is not an ISO 4217 code');
    else if (line.amount === null) exclude('MISSING_AMOUNT', 'Line has no amount');
    else if (!amount) exclude('INVALID_AMOUNT', 'Amount is not a decimal string');
    else if (!validPeriod) exclude('INVALID_PERIOD', 'Service period is missing or invalid');
    else if (interval === null) exclude('NON_RECURRING', 'One-time charge; not recurring revenue');
    else if (!recurring)
      exclude('UNSUPPORTED_INTERVAL', `Interval "${interval}" is not normalized`);
    else if (!amount.greaterThan(0))
      exclude('NON_POSITIVE_AMOUNT', 'Credits and zero lines are not recurring revenue');
    else if (!line.status || !INCLUDED_STATUSES.has(line.status)) {
      const reason = (line.status ? STATUS_EXCLUSIONS[line.status] : undefined) ?? 'UNKNOWN_STATUS';
      exclude(reason, `Invoice status "${line.status ?? 'missing'}" is not contracted revenue`);
    } else {
      const key = [
        line.customerId,
        line.subscriptionId ?? line.lineId,
        line.periodStart,
        line.periodEnd,
        currency,
        amount.toFixed(),
      ].join('|');
      const original = seen.get(key);
      if (original) {
        exclude('DUPLICATE_LINE', `Same subscription, period and amount as line ${original}`);
        continue;
      }
      seen.set(key, line.lineId);
      if (monthly === null || !line.periodStart || !line.periodEnd) continue;
      entries.push({
        ref: line.ref,
        lineId: line.lineId,
        customerId: line.customerId,
        customerName: line.customerName,
        currency,
        monthlyAmount: monthly,
        periodStart: line.periodStart,
        periodEnd: line.periodEnd,
        firstMonth: window.first,
        lastMonth: window.last,
      });
    }
  }

  const firstMonth =
    entries
      .map((entry) => entry.firstMonth)
      .filter((month): month is string => month !== null)
      .sort()[0] ?? null;
  return { version: METRICS_ENGINE_VERSION, entries, exclusions, firstMonth };
}

/** One included line's contribution to a month, in original and base currency. */
export interface Contribution {
  readonly ref: SourceRef;
  readonly lineId: string;
  readonly original: MoneyValue;
  readonly converted: MoneyValue;
  readonly fx: {
    rate: string;
    rateDate: string;
    source: string;
    refs: readonly SourceRef[];
  } | null;
}

export interface CustomerMonth {
  readonly customerId: string;
  readonly customerName: string | null;
  readonly mrr: Decimal;
  readonly contributions: readonly Contribution[];
}

export interface MonthSnapshot {
  readonly month: string;
  readonly customers: ReadonlyMap<string, CustomerMonth>;
  readonly total: Decimal;
  /** Lines active this month that could not be converted to the base currency. */
  readonly exclusions: readonly Exclusion[];
}

/**
 * Month-end MRR by customer in the base currency. Each contribution converts
 * at the fixing in force at that month's end (point-in-time), never today's.
 */
export function snapshotMonth(
  ledger: RevenueLedger,
  month: string,
  baseCurrency: string,
  fx: FxTable,
): MonthSnapshot {
  const onDate = monthEnd(month);
  const customers = new Map<
    string,
    { name: string | null; mrr: Decimal; contributions: Contribution[] }
  >();
  const exclusions: Exclusion[] = [];
  for (const entry of ledger.entries) {
    if (!isActiveIn(entry, month)) continue;
    const lookup = fx.rate(entry.currency, baseCurrency, onDate);
    if (!lookup.ok) {
      exclusions.push({
        ref: entry.ref,
        reason: lookup.reason,
        detail: lookup.detail,
        customerId: entry.customerId,
        month,
        monthlyAmount: money(entry.monthlyAmount, entry.currency),
      });
      continue;
    }
    const converted = entry.monthlyAmount.times(lookup.rate.rate);
    const current = customers.get(entry.customerId) ?? {
      name: entry.customerName,
      mrr: new D(0),
      contributions: [],
    };
    current.mrr = current.mrr.plus(converted);
    current.name ??= entry.customerName;
    current.contributions.push({
      ref: entry.ref,
      lineId: entry.lineId,
      original: money(entry.monthlyAmount, entry.currency),
      converted: money(converted, baseCurrency),
      fx:
        entry.currency === baseCurrency
          ? null
          : {
              rate: lookup.rate.rate,
              rateDate: lookup.rate.rateDate,
              source: lookup.rate.source,
              refs: lookup.rate.refs,
            },
    });
    customers.set(entry.customerId, current);
  }
  const result = new Map<string, CustomerMonth>();
  let total = new D(0);
  for (const [id, value] of [...customers.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!value.mrr.greaterThan(0)) continue;
    result.set(id, {
      customerId: id,
      customerName: value.name,
      mrr: value.mrr,
      contributions: value.contributions,
    });
    total = total.plus(value.mrr);
  }
  return { month, customers: result, total, exclusions };
}
