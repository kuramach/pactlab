/**
 * What an uploaded export is imported as: billing (ADR 0004) and, per pack,
 * industry extracts (ADR 0010). Each pack adds its targets here with an
 * `import_target` enum value in its migration.
 */
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

/** Whether a target's rows describe people at all, and how (rule 7). */
export type PeopleData = 'NONE' | 'AGGREGATE' | 'PSEUDONYMOUS';

export interface TargetDefinition {
  readonly target: ImportTarget;
  /** "Invoice lines", "Rent roll", … — shown on Sources. */
  readonly label: string;
  readonly people: PeopleData;
  /**
   * Refuse files whose header looks like named, contact, identity or pay data
   * (`peopleColumnProblems`). On for every pack target; billing keeps its
   * ADR 0004 behaviour (unmapped columns are never imported).
   */
  readonly refusesPeopleColumns: boolean;
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
  label: 'Invoice lines',
  people: 'NONE',
  refusesPeopleColumns: false,
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

/**
 * Header words that mark named, contact, identity or compensation data. A
 * pack extract carrying them is refused before anything is imported; people
 * appear only as aggregates or pseudonymous references (rule 7).
 */
const PEOPLE_COLUMN_WORDS = [
  'first_name', 'last_name', 'full_name', 'given_name', 'surname', 'employee_name', 'person_name', 'patient_name', 'resident_name', 'tenant_contact',
  'email', 'e_mail', 'phone', 'mobile', 'telephone', 'home_address', 'street_address',
  'ssn', 'social_security', 'national_id', 'national_insurance', 'passport', 'tax_id', 'date_of_birth', 'dob', 'birth_date', 'birthdate',
  'salary', 'compensation', 'bonus', 'wage', 'wages', 'pay_rate', 'payrate', 'base_pay', 'equity_grant',
  'diagnosis', 'medical_record', 'mrn', 'patient_id',
] as const;

const normalizeHeader = (column: string) => column.toLowerCase().trim().replaceAll(/[^a-z0-9]+/g, '_').replaceAll(/^_|_$/g, '');

/** Columns a pack target refuses, with the reason; empty when the file may be imported. */
export function peopleColumnProblems(definition: TargetDefinition, header: readonly string[]): string[] {
  if (!definition.refusesPeopleColumns) return [];
  return header
    .filter((column) => {
      const name = normalizeHeader(column);
      return PEOPLE_COLUMN_WORDS.some((word) => name === word || name.startsWith(`${word}_`) || name.endsWith(`_${word}`));
    })
    .map((column) => `Column "${column}" looks like named, contact, identity, health or pay data. Remove it: this extract accepts ${definition.people === 'NONE' ? 'no people data' : definition.people === 'AGGREGATE' ? 'aggregates only' : 'pseudonymous references only'}.`);
}

/** A target's Pactlab standard template: its field names as a CSV header. */
export function targetTemplateCsv(definition: TargetDefinition): string {
  return `${definition.fields.map((field) => field.name).join(',')}\n`;
}

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
