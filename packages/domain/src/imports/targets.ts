/**
 * What an uploaded export is imported as: billing (ADR 0004) and, per pack,
 * industry extracts (ADR 0010). Each pack adds its targets here with an
 * `import_target` enum value in its migration.
 */
export const IMPORT_TARGETS = [
  'BILLING_INVOICE_LINE',
  'FINTECH_LOAN_TAPE',
  'FINTECH_AML_ALERT',
  'MULTIFAMILY_RENT_ROLL',
  'MULTIFAMILY_T12',
  'MULTIFAMILY_DELINQUENCY',
  'MULTIFAMILY_INSPECTION',
  'HEALTHCARE_CLAIMS_SUMMARY',
  'HEALTHCARE_PROVIDER_ROSTER',
  'TELECOM_SUBSCRIBERS',
] as const;
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
  /** The standard file name: template downloads, and the demo data's file for this target. */
  readonly fileName: string;
  readonly people: PeopleData;
  /**
   * Refuse files whose header looks like named, contact, identity or pay data
   * (`peopleColumnProblems`). On for every pack target; billing keeps its
   * ADR 0004 behaviour (unmapped columns are never imported).
   */
  readonly refusesPeopleColumns: boolean;
  readonly evidenceType: string;
  readonly recordIdField: string;
  /** When one column is not unique (e.g. month and payer), the columns that together identify a record. */
  readonly recordIdFields?: readonly string[];
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
  fileName: 'invoice-lines.csv',
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

/** Fintech (T-058): a loan-level tape. No borrower names or identifiers beyond the loan id. */
export const FINTECH_LOAN_TAPE: TargetDefinition = {
  target: 'FINTECH_LOAN_TAPE',
  label: 'Loan tape',
  fileName: 'loan-tape.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'fintech.loan',
  recordIdField: 'loan_id',
  observedAtFields: ['originated'],
  fields: [
    { name: 'loan_id', label: 'Loan id', kind: 'text', required: true, hint: 'Unique id of the loan; never a borrower name or account number.' },
    { name: 'originated', label: 'Origination date', kind: 'date', required: true, hint: 'When the loan was made.' },
    { name: 'principal', label: 'Original principal', kind: 'money', required: true, hint: 'Amount lent.' },
    { name: 'balance', label: 'Outstanding balance', kind: 'money', required: true, hint: 'Balance at the tape date; 0 for a charged-off loan.' },
    { name: 'currency', label: 'Currency', kind: 'currency', required: true, hint: 'ISO 4217 code such as USD or EUR.' },
    { name: 'days_past_due', label: 'Days past due', kind: 'decimal', required: true, hint: 'Whole days; 0 when current.' },
    { name: 'status', label: 'Status', kind: 'code', required: true, hint: 'current, delinquent or charged_off.' },
  ],
};

/** Fintech (T-058): transaction-monitoring alerts and whether review evidence exists. */
export const FINTECH_AML_ALERT: TargetDefinition = {
  target: 'FINTECH_AML_ALERT',
  label: 'AML alerts',
  fileName: 'aml-alerts.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'fintech.aml_alert',
  recordIdField: 'alert_id',
  observedAtFields: ['raised'],
  fields: [
    { name: 'alert_id', label: 'Alert id', kind: 'text', required: true, hint: 'Unique id of the alert.' },
    { name: 'raised', label: 'Raised on', kind: 'date', required: true, hint: 'When the monitoring rule fired.' },
    { name: 'rule', label: 'Monitoring rule', kind: 'code', required: true, hint: 'The scenario that raised it, e.g. velocity or structuring.' },
    { name: 'status', label: 'Status', kind: 'code', required: true, hint: 'open or closed.' },
    { name: 'review_evidence', label: 'Review evidence on file', kind: 'code', required: true, hint: 'yes when the case file records what was reviewed and why; otherwise no.' },
  ],
};

/**
 * Multifamily (T-059). Property extracts carry no currency column: amounts are
 * in the deal's base currency. Residents appear only as units — never names.
 */
const IN_BASE_CURRENCY = 'In the deal\'s base currency.';

export const MULTIFAMILY_RENT_ROLL: TargetDefinition = {
  target: 'MULTIFAMILY_RENT_ROLL',
  label: 'Rent roll',
  fileName: 'rent-roll.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'multifamily.unit',
  recordIdField: 'unit',
  observedAtFields: ['lease_start'],
  fields: [
    { name: 'unit', label: 'Unit', kind: 'text', required: true, hint: 'Unit number; never a resident name.' },
    { name: 'building', label: 'Building', kind: 'text', required: true, hint: 'Building or block.' },
    { name: 'type', label: 'Unit type', kind: 'text', required: false, hint: 'e.g. 1BR, 2BR.' },
    { name: 'sqft', label: 'Square feet', kind: 'decimal', required: false, hint: 'Rentable area.' },
    { name: 'status', label: 'Status', kind: 'code', required: true, hint: 'occupied or vacant.' },
    { name: 'lease_start', label: 'Lease start', kind: 'date', required: false, hint: 'Empty for a vacant unit.' },
    { name: 'lease_end', label: 'Lease end', kind: 'date', required: false, hint: 'Empty for a vacant unit.' },
    { name: 'in_place_rent', label: 'In-place rent', kind: 'money', required: true, hint: `Monthly rent on the current lease; 0 when vacant. ${IN_BASE_CURRENCY}` },
    { name: 'market_rent', label: 'Market rent', kind: 'money', required: true, hint: `Monthly market rent for the unit. ${IN_BASE_CURRENCY}` },
    { name: 'balance_due', label: 'Balance due', kind: 'money', required: false, hint: `Arrears on the unit. ${IN_BASE_CURRENCY}` },
  ],
};

export const MULTIFAMILY_T12: TargetDefinition = {
  target: 'MULTIFAMILY_T12',
  label: 'T-12 operating statement',
  fileName: 't12.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'multifamily.t12_month',
  recordIdField: 'month',
  observedAtFields: [],
  fields: [
    { name: 'month', label: 'Month', kind: 'text', required: true, hint: 'YYYY-MM, one row per month of the trailing twelve.' },
    { name: 'rental_income', label: 'Rental income', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
    { name: 'other_income', label: 'Other income', kind: 'money', required: false, hint: IN_BASE_CURRENCY },
    { name: 'operating_expenses', label: 'Operating expenses', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
    { name: 'net_operating_income', label: 'Net operating income', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
  ],
};

export const MULTIFAMILY_DELINQUENCY: TargetDefinition = {
  target: 'MULTIFAMILY_DELINQUENCY',
  label: 'Delinquency report',
  fileName: 'delinquency.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'multifamily.delinquency',
  recordIdField: 'unit',
  observedAtFields: [],
  fields: [
    { name: 'unit', label: 'Unit', kind: 'text', required: true, hint: 'Unit number; never a resident name.' },
    { name: 'building', label: 'Building', kind: 'text', required: true, hint: 'Building or block.' },
    { name: 'balance_due', label: 'Balance due', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
    { name: 'days_past_due', label: 'Days past due', kind: 'decimal', required: false, hint: 'Whole days.' },
  ],
};

export const MULTIFAMILY_INSPECTION: TargetDefinition = {
  target: 'MULTIFAMILY_INSPECTION',
  label: 'Unit inspections',
  fileName: 'unit-inspections.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'multifamily.inspection',
  recordIdField: 'unit',
  observedAtFields: [],
  fields: [
    { name: 'unit', label: 'Unit', kind: 'text', required: true, hint: 'Unit number.' },
    { name: 'building', label: 'Building', kind: 'text', required: true, hint: 'Building or block.' },
    { name: 'condition', label: 'Condition', kind: 'code', required: true, hint: 'good, fair or poor.' },
    { name: 'estimated_repair_cost', label: 'Estimated repair cost', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
  ],
};

/** Healthcare (T-061): claims by payer and month — never patient-level data. */
export const HEALTHCARE_CLAIMS_SUMMARY: TargetDefinition = {
  target: 'HEALTHCARE_CLAIMS_SUMMARY',
  label: 'Claims summary',
  fileName: 'claims-summary.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'healthcare.claims_month',
  recordIdField: 'month',
  recordIdFields: ['month', 'payer'],
  observedAtFields: [],
  fields: [
    { name: 'month', label: 'Month', kind: 'text', required: true, hint: 'YYYY-MM.' },
    { name: 'payer', label: 'Payer', kind: 'text', required: true, hint: 'Payer or programme name; never a patient.' },
    { name: 'claims', label: 'Claims', kind: 'decimal', required: true, hint: 'Claims submitted in the month.' },
    { name: 'billed', label: 'Billed', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
    { name: 'paid', label: 'Paid', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
    { name: 'denial_rate_pct', label: 'Denial rate (%)', kind: 'decimal', required: true, hint: 'Share of claims denied, in percent.' },
  ],
};

/** Healthcare (T-061): providers as pseudonymous references, with FTE and credential expiry. */
export const HEALTHCARE_PROVIDER_ROSTER: TargetDefinition = {
  target: 'HEALTHCARE_PROVIDER_ROSTER',
  label: 'Provider roster',
  fileName: 'provider-roster.csv',
  people: 'PSEUDONYMOUS',
  refusesPeopleColumns: true,
  evidenceType: 'healthcare.provider',
  recordIdField: 'provider_ref',
  observedAtFields: [],
  fields: [
    { name: 'provider_ref', label: 'Provider reference', kind: 'text', required: true, hint: 'A pseudonymous reference such as PR-07 — never a name or licence number.' },
    { name: 'specialty', label: 'Specialty', kind: 'text', required: true, hint: 'e.g. Primary care.' },
    { name: 'fte', label: 'FTE', kind: 'decimal', required: true, hint: 'Full-time equivalent, e.g. 0.6.' },
    { name: 'credential_expiry', label: 'Credential expiry', kind: 'date', required: true, hint: 'When the provider’s licence or credential lapses.' },
  ],
};

/** Telecom and media (T-062): billed subscribers and ARPU by month, region and plan — no subscriber identities. */
export const TELECOM_SUBSCRIBERS: TargetDefinition = {
  target: 'TELECOM_SUBSCRIBERS',
  label: 'Subscribers by month',
  fileName: 'subscribers-by-month.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'telecom.subscribers_month',
  recordIdField: 'month',
  recordIdFields: ['month', 'region', 'plan'],
  observedAtFields: [],
  fields: [
    { name: 'month', label: 'Month', kind: 'text', required: true, hint: 'YYYY-MM.' },
    { name: 'region', label: 'Region', kind: 'text', required: true, hint: 'Region or market.' },
    { name: 'plan', label: 'Plan', kind: 'text', required: true, hint: 'Plan or product.' },
    { name: 'billed_subscribers', label: 'Billed subscribers', kind: 'decimal', required: true, hint: 'Subscribers billed in the month (a count, not a reported figure).' },
    { name: 'arpu', label: 'ARPU', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
  ],
};

export const IMPORT_TARGET_DEFINITIONS: Readonly<Record<ImportTarget, TargetDefinition>> = {
  BILLING_INVOICE_LINE,
  FINTECH_LOAN_TAPE,
  FINTECH_AML_ALERT,
  MULTIFAMILY_RENT_ROLL,
  MULTIFAMILY_T12,
  MULTIFAMILY_DELINQUENCY,
  MULTIFAMILY_INSPECTION,
  HEALTHCARE_CLAIMS_SUMMARY,
  HEALTHCARE_PROVIDER_ROSTER,
  TELECOM_SUBSCRIBERS,
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
