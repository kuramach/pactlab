/** What an uploaded export is imported as. CSV import is billing-only (ADR 0004). */
export const IMPORT_TARGETS = ['BILLING_INVOICE_LINE'] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

export type FieldKind = 'text' | 'date' | 'money' | 'decimal' | 'currency' | 'code';

export interface TargetField {
  readonly name: string;
  readonly label: string;
  readonly kind: FieldKind;
  /** Rows missing a required field are reported and not imported. */
  readonly required: boolean;
  readonly hint: string;
}

export interface TargetDefinition {
  readonly target: ImportTarget;
  readonly evidenceType: string;
  readonly recordIdField: string;
  /** Field used as the observation date, falling back in order. */
  readonly observedAtFields: readonly string[];
  readonly fields: readonly TargetField[];
}

/**
 * The Pactlab standard invoice line. Same columns the Stripe adapters and the
 * fixture exports normalize to, so the revenue engine reads every system alike.
 */
export const BILLING_INVOICE_LINE: TargetDefinition = {
  target: 'BILLING_INVOICE_LINE',
  evidenceType: 'billing.invoice_line',
  recordIdField: 'line_id',
  observedAtFields: ['created', 'period_start'],
  fields: [
    { name: 'line_id', label: 'Line id', kind: 'text', required: true, hint: 'Unique id of the invoice line (or invoice + line number).' },
    { name: 'invoice_id', label: 'Invoice id', kind: 'text', required: false, hint: 'Invoice or billing document number.' },
    { name: 'customer_id', label: 'Customer id', kind: 'text', required: false, hint: 'Lines without a customer are excluded from ARR, with the reason shown.' },
    { name: 'customer_name', label: 'Customer name', kind: 'text', required: false, hint: 'Optional; shown next to the id.' },
    { name: 'subscription_id', label: 'Subscription / contract id', kind: 'text', required: false, hint: 'Optional.' },
    { name: 'price_id', label: 'Price / product id', kind: 'text', required: false, hint: 'Optional.' },
    { name: 'currency', label: 'Currency', kind: 'currency', required: true, hint: 'ISO 4217 code such as USD or EUR.' },
    { name: 'amount', label: 'Amount', kind: 'money', required: true, hint: 'Line amount, before tax.' },
    { name: 'interval', label: 'Billing interval', kind: 'code', required: false, hint: 'month or year. Use a fixed value if every line shares one.' },
    { name: 'interval_count', label: 'Interval count', kind: 'decimal', required: false, hint: 'Defaults to 1 when empty.' },
    { name: 'period_start', label: 'Service period start', kind: 'date', required: false, hint: 'First day of the period the line pays for.' },
    { name: 'period_end', label: 'Service period end', kind: 'date', required: false, hint: 'End of that period (exclusive).' },
    { name: 'invoice_status', label: 'Invoice status', kind: 'code', required: false, hint: 'paid, open, void, uncollectible or draft.' },
    { name: 'created', label: 'Invoice date', kind: 'date', required: false, hint: 'When the invoice was issued.' },
  ],
};

export const IMPORT_TARGET_DEFINITIONS: Readonly<Record<ImportTarget, TargetDefinition>> = {
  BILLING_INVOICE_LINE,
};

/** Billing systems a seller may export from. Templates live with the connectors. */
export const BILLING_SYSTEMS = [
  'stripe',
  'netsuite',
  'zuora',
  'chargebee',
  'sap_s4hana',
  'sap_ecc',
  'oracle_fusion',
  'quickbooks',
  'pactlab_standard',
  'other',
] as const;
export type BillingSystem = (typeof BILLING_SYSTEMS)[number];

export const BILLING_SYSTEM_LABELS: Readonly<Record<BillingSystem, string>> = {
  stripe: 'Stripe',
  netsuite: 'Oracle NetSuite',
  zuora: 'Zuora',
  chargebee: 'Chargebee',
  sap_s4hana: 'SAP S/4HANA',
  sap_ecc: 'SAP ECC',
  oracle_fusion: 'Oracle Fusion Cloud ERP',
  quickbooks: 'QuickBooks',
  pactlab_standard: 'Pactlab standard template',
  other: 'Another system',
};
