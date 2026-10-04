import type { CsvDatasetMapping } from '@pactlab/domain';

export const STRIPE_PROVIDER = 'stripe';

/** Evidence type of one normalized invoice line, whichever connection carried it. */
export const INVOICE_LINE_EVIDENCE_TYPE = 'billing.invoice_line';

/**
 * Columns of the itemized invoice-line export the adapters normalize to. Money
 * stays a decimal string in major units; nothing here parses it to a number.
 */
export const INVOICE_LINE_COLUMNS = [
  'line_id',
  'invoice_id',
  'customer_id',
  'customer_name',
  'subscription_id',
  'price_id',
  'currency',
  'amount',
  'interval',
  'interval_count',
  'period_start',
  'period_end',
  'invoice_status',
  'created',
] as const;

/** Column mapping shared by the Stripe adapters and any CSV connection carrying the same export. */
export function invoiceLineMapping(dataset: string): CsvDatasetMapping {
  return {
    dataset,
    evidenceType: INVOICE_LINE_EVIDENCE_TYPE,
    recordIdColumn: 'line_id',
    observedAtColumn: 'created',
  };
}

/** One invoice line as typed strings. Missing source values stay null; nothing is inferred. */
export interface InvoiceLine {
  readonly lineId: string;
  readonly invoiceId: string | null;
  readonly customerId: string | null;
  readonly customerName: string | null;
  readonly subscriptionId: string | null;
  readonly priceId: string | null;
  /** ISO 4217, upper-cased. */
  readonly currency: string | null;
  /** Decimal string in major units. */
  readonly amount: string | null;
  /** `month`, `year`, ... or null for a one-time charge. */
  readonly interval: string | null;
  readonly intervalCount: string | null;
  /** `YYYY-MM-DD`; the end is exclusive. */
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly status: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}/;

function dateOnly(value: string | null | undefined): string | null {
  return value && DATE.test(value) ? value.slice(0, 10) : null;
}

/** Map a normalized evidence record's canonical fields to a typed invoice line. */
export function parseInvoiceLine(
  canonical: Readonly<Record<string, string | null | undefined>>,
): InvoiceLine | null {
  const lineId = canonical['line_id'];
  if (!lineId) return null;
  const value = (key: string) => canonical[key] ?? null;
  return {
    lineId,
    invoiceId: value('invoice_id'),
    customerId: value('customer_id'),
    customerName: value('customer_name'),
    subscriptionId: value('subscription_id'),
    priceId: value('price_id'),
    currency: value('currency')?.toUpperCase() ?? null,
    amount: value('amount'),
    interval: value('interval')?.toLowerCase() ?? null,
    intervalCount: value('interval_count'),
    periodStart: dateOnly(value('period_start')),
    periodEnd: dateOnly(value('period_end')),
    status: value('invoice_status')?.toLowerCase() ?? null,
  };
}
