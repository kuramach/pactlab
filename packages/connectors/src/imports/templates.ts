import {
  BILLING_INVOICE_LINE,
  BILLING_SYSTEM_LABELS,
  BILLING_SYSTEMS,
  type AmountUnit,
  type BillingSystem,
  type DateFormat,
  type NumberFormat,
} from '@pactlab/domain';
import { INVOICE_LINE_COLUMNS } from '../stripe/invoice-line';

/**
 * How one billing system's export usually looks. Column aliases are added
 * only once verified against the vendor's official documentation (cited in
 * `verifiedFrom`) or a sanitized sample export — never guessed. Systems
 * without verified aliases still import: Pactlab suggests a mapping from
 * column names and the user confirms every field.
 */
export interface BillingTemplate {
  readonly system: BillingSystem;
  readonly label: string;
  readonly verified: boolean;
  readonly verifiedFrom: readonly string[];
  /** Canonical field → column names in this system's export. */
  readonly aliases: Readonly<Partial<Record<string, readonly string[]>>>;
  readonly defaults: {
    readonly dateFormat?: DateFormat;
    readonly numberFormat?: NumberFormat;
    readonly amountUnit?: AmountUnit;
  };
  /** What to export, in the seller's words. */
  readonly exportHint: string;
}

const unverified = (system: BillingSystem, exportHint: string): BillingTemplate => ({
  system,
  label: BILLING_SYSTEM_LABELS[system],
  verified: false,
  verifiedFrom: [],
  aliases: {},
  defaults: {},
  exportHint,
});

export const BILLING_TEMPLATES: Readonly<Record<BillingSystem, BillingTemplate>> = {
  pactlab_standard: {
    system: 'pactlab_standard',
    label: BILLING_SYSTEM_LABELS.pactlab_standard,
    verified: true,
    verifiedFrom: ['Pactlab standard invoice-line columns'],
    aliases: Object.fromEntries(INVOICE_LINE_COLUMNS.map((column) => [column, [column]])),
    defaults: { dateFormat: 'YYYY-MM-DD', numberFormat: 'DOT_DECIMAL', amountUnit: 'MAJOR' },
    exportHint: 'Fill the Pactlab standard template: one row per invoice line.',
  },
  stripe: {
    system: 'stripe',
    label: BILLING_SYSTEM_LABELS.stripe,
    verified: true,
    // Sigma / Data Pipeline `invoice_line_items`: amounts in the smallest currency unit.
    verifiedFrom: ['https://docs.stripe.com/data/query-billing-data', 'https://docs.stripe.com/api/invoice-line-item/object'],
    aliases: {
      line_id: ['id'],
      invoice_id: ['invoice_id'],
      subscription_id: ['subscription', 'source_id'],
      price_id: ['price_id'],
      currency: ['currency'],
      amount: ['amount'],
      period_start: ['period_start'],
      period_end: ['period_end'],
    },
    defaults: { dateFormat: 'YYYY-MM-DD', numberFormat: 'DOT_DECIMAL', amountUnit: 'MINOR' },
    exportHint:
      'Run a Sigma (or Data Pipeline) query over invoice_line_items joined to invoices for the customer, status and invoice date, and export it as CSV.',
  },
  netsuite: unverified('netsuite', 'Export a saved search of invoice lines with customer, amount, currency and service dates.'),
  zuora: unverified('zuora', 'Export invoice items (Data Source or report) with account, charge amount, currency and service period.'),
  chargebee: unverified('chargebee', 'Export invoice line items with customer, amount, currency and period dates.'),
  sap_s4hana: unverified('sap_s4hana', 'Export billing document items with sold-to party, net value, document currency and service dates.'),
  sap_ecc: unverified('sap_ecc', 'Export billing document items (report extract) with sold-to party, net value, currency and dates.'),
  oracle_fusion: unverified('oracle_fusion', 'Export receivables transaction lines with customer, amount, currency and service dates.'),
  quickbooks: unverified('quickbooks', 'Export invoice lines (sales by customer detail) with customer, amount and dates.'),
  other: unverified('other', 'Export one row per invoice line with customer, amount, currency and service period.'),
};

export function billingTemplate(system: BillingSystem): BillingTemplate {
  return BILLING_TEMPLATES[system];
}

/** Blank Pactlab standard template, header only. */
export function standardTemplateCsv(): string {
  return `${BILLING_INVOICE_LINE.fields.map((field) => field.name).join(',')}\n`;
}

export const BILLING_TEMPLATE_SYSTEMS = BILLING_SYSTEMS;
