/** Bumped whenever a formula, inclusion policy or rounding rule changes. */
export const METRICS_ENGINE_VERSION = 'saas-metrics-1';

/** Pointer back to the evidence record (and its citation) a number came from. */
export interface SourceRef {
  readonly evidenceId: string;
  readonly sourceRecordId: string;
  readonly citationId: string | null;
}

/** `{amount, currency}` with the amount as a fixed-scale decimal string. */
export interface MoneyValue {
  readonly amount: string;
  readonly currency: string;
}

/** One provider invoice line as typed strings; the engine decides inclusion. */
export interface RevenueLineInput {
  readonly ref: SourceRef;
  readonly lineId: string;
  readonly invoiceId: string | null;
  readonly customerId: string | null;
  readonly customerName: string | null;
  readonly subscriptionId: string | null;
  readonly currency: string | null;
  readonly amount: string | null;
  readonly interval: string | null;
  readonly intervalCount: string | null;
  /** `YYYY-MM-DD`, inclusive. */
  readonly periodStart: string | null;
  /** `YYYY-MM-DD`, exclusive. */
  readonly periodEnd: string | null;
  readonly status: string | null;
}

/** One cached reference-rate fixing: 1 `baseCurrency` = `rate` `quoteCurrency`. */
export interface FxRateInput {
  readonly ref: SourceRef;
  readonly baseCurrency: string | null;
  readonly quoteCurrency: string | null;
  readonly rate: string | null;
  readonly rateDate: string | null;
  readonly source: string | null;
}

export type ExclusionReason =
  | 'MISSING_CUSTOMER'
  | 'MISSING_AMOUNT'
  | 'INVALID_AMOUNT'
  | 'NON_POSITIVE_AMOUNT'
  | 'MISSING_CURRENCY'
  | 'INVALID_PERIOD'
  | 'NON_RECURRING'
  | 'UNSUPPORTED_INTERVAL'
  | 'INVOICE_VOID'
  | 'INVOICE_UNCOLLECTIBLE'
  | 'INVOICE_DRAFT'
  | 'UNKNOWN_STATUS'
  | 'DUPLICATE_LINE'
  | 'NO_FX_RATE'
  | 'STALE_FX_RATE'
  | 'INVALID_FX_RATE';

/** A source row left out of the ledger, with the reason. Exclusions are never silent. */
export interface Exclusion {
  readonly ref: SourceRef;
  readonly reason: ExclusionReason;
  readonly detail: string;
  readonly customerId: string | null;
  /** Set for exclusions that apply to one month only (FX). */
  readonly month: string | null;
  /** Monthly-equivalent amount in the original currency, when it could be computed. */
  readonly monthlyAmount: MoneyValue | null;
}
