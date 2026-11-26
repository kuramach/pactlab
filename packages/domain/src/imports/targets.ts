/**
 * What an uploaded export is imported as: billing (ADR 0004) and, per pack,
 * industry extracts (ADR 0010). Each pack adds its targets here with an
 * `import_target` enum value in its migration.
 */
export const IMPORT_TARGETS = [
  'BILLING_INVOICE_LINE',
  'FINTECH_LOAN_TAPE',
  'FINTECH_AML_ALERT',
  'FINTECH_PROCESSOR_VOLUME',
  'FINTECH_LICENCES',
  'MULTIFAMILY_RENT_ROLL',
  'MULTIFAMILY_T12',
  'MULTIFAMILY_DELINQUENCY',
  'MULTIFAMILY_INSPECTION',
  'HEALTHCARE_CLAIMS_SUMMARY',
  'HEALTHCARE_PROVIDER_ROSTER',
  'TELECOM_SUBSCRIBERS',
  'SERVICES_TIMESHEETS',
  'SERVICES_HEADCOUNT',
  'PHARMA_PATENTS',
  'PHARMA_PIPELINE',
  'ECOMMERCE_COHORTS',
  'ECOMMERCE_AD_SPEND',
  'CRE_RENT_ROLL',
  'CRE_CAM_RECONCILIATION',
  'HOTELS_OPERATING_HISTORY',
  'HOTELS_STR_BENCHMARK',
  'CLINICS_PATIENT_VOLUME',
  'CLINICS_EQUIPMENT',
  'CLINICS_CODING_SUMMARY',
  'HOSPITALS_CENSUS',
  'HOSPITALS_PAYER_MIX',
  'VENTURE_CAP_TABLE',
  'VENTURE_FINANCIALS',
  'SYNDICATION_TRACK_RECORD',
  'MUSIC_WORKS',
  'MUSIC_SPLITS',
  'MUSIC_TITLE_CHAIN',
  'MUSIC_ROYALTY_STATEMENTS',
  'ENERGY_PLANTS',
  'ENERGY_INTERESTS',
  'ENERGY_LEASES',
  'ENERGY_PRODUCTION',
  'ENERGY_LIABILITIES',
  'REGULATORY_FOOTPRINT',
  'REMEDY_PACKAGE',
  'FINANCIAL_PNL',
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
  /**
   * A line-by-line statement (a P&L): every line carries a kind (revenue, expense, subtotal…), chosen
   * per account in the mapping; subtotal lines are checked against the lines, never imported.
   */
  readonly lineItems?: boolean;
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
 * Fintech (T-159): the processor or bank settlement export, one row per month and processor —
 * processed volume, transaction and chargeback counts, the company's net revenue on that volume and
 * the fraud losses it bore. Counts and amounts only; no merchant or cardholder is identified.
 */
export const FINTECH_PROCESSOR_VOLUME: TargetDefinition = {
  target: 'FINTECH_PROCESSOR_VOLUME',
  label: 'Processor volume',
  fileName: 'processor-volume.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'fintech.processor_month',
  recordIdField: 'month',
  recordIdFields: ['month', 'processor'],
  observedAtFields: [],
  fields: [
    { name: 'month', label: 'Month', kind: 'text', required: true, hint: 'YYYY-MM.' },
    { name: 'processor', label: 'Processor or bank', kind: 'text', required: true, hint: 'The processor, acquirer or settlement bank the export comes from.' },
    { name: 'gross_volume', label: 'Processed volume', kind: 'money', required: true, hint: 'Settled payment volume for the month, as the processor reports it. In the deal\'s base currency.' },
    { name: 'transactions', label: 'Transactions', kind: 'decimal', required: true, hint: 'Settled transactions in the month (a count).' },
    { name: 'net_revenue', label: 'Net revenue', kind: 'money', required: true, hint: 'The company\'s revenue on that volume after interchange and network fees. In the deal\'s base currency.' },
    { name: 'chargeback_count', label: 'Chargebacks', kind: 'decimal', required: true, hint: 'Chargebacks received in the month (a count).' },
    { name: 'chargeback_amount', label: 'Chargeback amount', kind: 'money', required: false, hint: 'In the deal\'s base currency.' },
    { name: 'fraud_losses', label: 'Fraud losses', kind: 'money', required: false, hint: 'Losses the company bore from fraud in the month. In the deal\'s base currency.' },
  ],
};

/**
 * Fintech (T-159): the licence and sponsor register — money-transmitter, lending and other state or
 * federal licences, and sponsor-bank agreements, each with its status and dates as the seller keeps
 * them. The documents govern: a licence or agreement that states its own expiry is read from the page.
 */
export const FINTECH_LICENCES: TargetDefinition = {
  target: 'FINTECH_LICENCES',
  label: 'Licence and sponsor register',
  fileName: 'licence-register.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'fintech.licence',
  recordIdField: 'licence_id',
  observedAtFields: [],
  fields: [
    { name: 'licence_id', label: 'Licence or agreement id', kind: 'text', required: true, hint: 'The licence number, or the agreement\'s reference.' },
    { name: 'kind', label: 'Kind', kind: 'code', required: true, hint: 'money_transmitter, lending, payment_institution, e_money, other_licence or sponsor_bank.' },
    { name: 'jurisdiction', label: 'Jurisdiction', kind: 'text', required: true, hint: 'The state, country or regulator area it covers; for a sponsor bank, where the program runs.' },
    { name: 'authority', label: 'Issued by', kind: 'text', required: true, hint: 'The regulator that issued the licence, or the sponsor bank.' },
    { name: 'status', label: 'Status', kind: 'code', required: true, hint: 'active, pending, lapsed, surrendered or revoked, as the register records it.' },
    { name: 'issued_on', label: 'Issued or signed', kind: 'date', required: false, hint: 'When it was issued or signed.' },
    { name: 'expires_on', label: 'Expires', kind: 'date', required: false, hint: 'When it expires or must be renewed; blank when it does not expire.' },
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

/** Professional services (T-063): available and billable hours by month and team — aggregates, never people. */
export const SERVICES_TIMESHEETS: TargetDefinition = {
  target: 'SERVICES_TIMESHEETS',
  label: 'Timesheets summary',
  fileName: 'timesheets-summary.csv',
  people: 'AGGREGATE',
  refusesPeopleColumns: true,
  evidenceType: 'services.timesheet_month',
  recordIdField: 'month',
  recordIdFields: ['month', 'team'],
  observedAtFields: [],
  fields: [
    { name: 'month', label: 'Month', kind: 'text', required: true, hint: 'YYYY-MM.' },
    { name: 'team', label: 'Team', kind: 'text', required: true, hint: 'Team or practice; never a person.' },
    { name: 'headcount', label: 'Headcount', kind: 'decimal', required: true, hint: 'People in the team that month.' },
    { name: 'available_hours', label: 'Available hours', kind: 'decimal', required: true, hint: 'Hours available after leave and holidays.' },
    { name: 'billable_hours', label: 'Billable hours', kind: 'decimal', required: true, hint: 'Hours billed to clients.' },
  ],
};

/** Professional services (T-063): starters, leavers and headcount by month and role family — aggregates only. */
export const SERVICES_HEADCOUNT: TargetDefinition = {
  target: 'SERVICES_HEADCOUNT',
  label: 'Headcount movements',
  fileName: 'headcount-movements.csv',
  people: 'AGGREGATE',
  refusesPeopleColumns: true,
  evidenceType: 'services.headcount_month',
  recordIdField: 'month',
  recordIdFields: ['month', 'role_family'],
  observedAtFields: [],
  fields: [
    { name: 'month', label: 'Month', kind: 'text', required: true, hint: 'YYYY-MM.' },
    { name: 'role_family', label: 'Role family', kind: 'text', required: true, hint: 'e.g. Delivery; never a person or a title held by one person.' },
    { name: 'starters', label: 'Starters', kind: 'decimal', required: true, hint: 'People who joined in the month.' },
    { name: 'leavers', label: 'Leavers', kind: 'decimal', required: true, hint: 'People who left in the month.' },
    { name: 'headcount', label: 'Headcount', kind: 'decimal', required: true, hint: 'At the end of the month.' },
  ],
};

/** Pharma and biotech (T-064): patent families by product and jurisdiction, with expiry. */
export const PHARMA_PATENTS: TargetDefinition = {
  target: 'PHARMA_PATENTS',
  label: 'Patent schedule',
  fileName: 'patent-schedule.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'pharma.patent',
  recordIdField: 'family',
  recordIdFields: ['family', 'jurisdiction'],
  observedAtFields: [],
  fields: [
    { name: 'family', label: 'Patent family', kind: 'text', required: true, hint: 'Family reference, e.g. PF-01.' },
    { name: 'product', label: 'Product', kind: 'text', required: true, hint: 'The product the family protects.' },
    { name: 'jurisdiction', label: 'Jurisdiction', kind: 'text', required: true, hint: 'e.g. US or EP.' },
    { name: 'type', label: 'Patent type', kind: 'text', required: true, hint: 'composition of matter, formulation, method of use, …' },
    { name: 'expiry', label: 'Expiry', kind: 'date', required: true, hint: 'Expiry including any extension granted.' },
  ],
};

/** Pharma and biotech (T-064): development programmes, phase and next milestone. */
export const PHARMA_PIPELINE: TargetDefinition = {
  target: 'PHARMA_PIPELINE',
  label: 'Pipeline',
  fileName: 'pipeline.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'pharma.programme',
  recordIdField: 'programme',
  observedAtFields: [],
  fields: [
    { name: 'programme', label: 'Programme', kind: 'text', required: true, hint: 'Programme code.' },
    { name: 'indication', label: 'Indication', kind: 'text', required: true, hint: 'The disease or condition.' },
    { name: 'phase', label: 'Phase', kind: 'text', required: true, hint: 'e.g. Phase 3.' },
    { name: 'next_milestone', label: 'Next milestone', kind: 'text', required: true, hint: 'e.g. Top-line data.' },
    { name: 'expected', label: 'Expected', kind: 'text', required: true, hint: 'When, e.g. 2027-Q2.' },
  ],
};

/** E-commerce and DTC (T-065): active customers by first-purchase cohort and month — counts, never customers. */
export const ECOMMERCE_COHORTS: TargetDefinition = {
  target: 'ECOMMERCE_COHORTS',
  label: 'Orders by cohort',
  fileName: 'orders-by-cohort.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'ecommerce.cohort_month',
  recordIdField: 'first_purchase_month',
  recordIdFields: ['first_purchase_month', 'month'],
  observedAtFields: [],
  fields: [
    { name: 'first_purchase_month', label: 'First-purchase month', kind: 'text', required: true, hint: 'The cohort, YYYY-MM.' },
    { name: 'month', label: 'Month', kind: 'text', required: true, hint: 'YYYY-MM.' },
    { name: 'months_since_first', label: 'Months since first purchase', kind: 'decimal', required: true, hint: '0 for the cohort’s first month.' },
    { name: 'active_customers', label: 'Active customers', kind: 'decimal', required: true, hint: 'Customers from the cohort who bought in the month (a count).' },
  ],
};

/** E-commerce and DTC (T-065): advertising spend and new customers by month and channel. */
export const ECOMMERCE_AD_SPEND: TargetDefinition = {
  target: 'ECOMMERCE_AD_SPEND',
  label: 'Ad spend',
  fileName: 'ad-spend.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'ecommerce.ad_spend_month',
  recordIdField: 'month',
  recordIdFields: ['month', 'channel'],
  observedAtFields: [],
  fields: [
    { name: 'month', label: 'Month', kind: 'text', required: true, hint: 'YYYY-MM.' },
    { name: 'channel', label: 'Channel', kind: 'text', required: true, hint: 'e.g. paid social, search.' },
    { name: 'spend', label: 'Spend', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
    { name: 'new_customers', label: 'New customers', kind: 'decimal', required: true, hint: 'First-time customers attributed to the channel.' },
  ],
};

/** Commercial property (T-066): leases by suite with expiry, base and market rent — tenants are businesses. */
export const CRE_RENT_ROLL: TargetDefinition = {
  target: 'CRE_RENT_ROLL',
  label: 'Commercial rent roll',
  fileName: 'rent-roll.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'cre.lease',
  recordIdField: 'suite',
  observedAtFields: [],
  fields: [
    { name: 'tenant', label: 'Tenant', kind: 'text', required: true, hint: 'The tenant business.' },
    { name: 'suite', label: 'Suite', kind: 'text', required: true, hint: 'Suite or unit.' },
    { name: 'sqft', label: 'Square feet', kind: 'decimal', required: false, hint: 'Leased area.' },
    { name: 'lease_start', label: 'Lease start', kind: 'date', required: false, hint: 'Commencement date.' },
    { name: 'lease_end', label: 'Lease end', kind: 'date', required: true, hint: 'Expiry date, before any option to renew.' },
    { name: 'monthly_base_rent', label: 'Monthly base rent', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
    { name: 'monthly_market_rent', label: 'Monthly market rent', kind: 'money', required: true, hint: `The appraiser's or broker's market rent for the suite. ${IN_BASE_CURRENCY}` },
  ],
};

/** Commercial property (T-066): common-area-maintenance expenses against recoveries, by year and category. */
export const CRE_CAM_RECONCILIATION: TargetDefinition = {
  target: 'CRE_CAM_RECONCILIATION',
  label: 'CAM reconciliation',
  fileName: 'cam-reconciliation.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'cre.cam_category',
  recordIdField: 'year',
  recordIdFields: ['year', 'category'],
  observedAtFields: [],
  fields: [
    { name: 'year', label: 'Year', kind: 'text', required: true, hint: 'Reconciliation year, YYYY.' },
    { name: 'category', label: 'Category', kind: 'text', required: true, hint: 'e.g. Insurance, Security.' },
    { name: 'expenses', label: 'Expenses', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
    { name: 'recoveries', label: 'Recoveries', kind: 'money', required: true, hint: `Billed back to tenants. ${IN_BASE_CURRENCY}` },
  ],
};

/** Hotels (T-067): monthly operating history from the property-management system — no guest data. */
export const HOTELS_OPERATING_HISTORY: TargetDefinition = {
  target: 'HOTELS_OPERATING_HISTORY',
  label: 'Operating history',
  fileName: 'operating-history.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'hotels.operating_month',
  recordIdField: 'month',
  observedAtFields: [],
  fields: [
    { name: 'month', label: 'Month', kind: 'text', required: true, hint: 'YYYY-MM.' },
    { name: 'rooms_available', label: 'Rooms available', kind: 'decimal', required: true, hint: 'Room-nights available.' },
    { name: 'rooms_sold', label: 'Rooms sold', kind: 'decimal', required: true, hint: 'Room-nights sold.' },
    { name: 'adr', label: 'ADR', kind: 'money', required: true, hint: `Average daily rate. ${IN_BASE_CURRENCY}` },
    { name: 'revpar', label: 'RevPAR', kind: 'money', required: true, hint: `Revenue per available room. ${IN_BASE_CURRENCY}` },
    { name: 'room_revenue', label: 'Room revenue', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
    { name: 'fb_revenue', label: 'F&B revenue', kind: 'money', required: false, hint: IN_BASE_CURRENCY },
    { name: 'gross_operating_profit', label: 'Gross operating profit', kind: 'money', required: false, hint: IN_BASE_CURRENCY },
  ],
};

/** Hotels (T-067): an STR-style benchmark of the hotel against its competitive set. */
export const HOTELS_STR_BENCHMARK: TargetDefinition = {
  target: 'HOTELS_STR_BENCHMARK',
  label: 'STR benchmark',
  fileName: 'str-benchmark.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'hotels.benchmark_month',
  recordIdField: 'month',
  observedAtFields: [],
  fields: [
    { name: 'month', label: 'Month', kind: 'text', required: true, hint: 'YYYY-MM.' },
    { name: 'occupancy', label: 'Occupancy', kind: 'decimal', required: true, hint: 'A fraction, e.g. 0.734.' },
    { name: 'adr', label: 'ADR', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
    { name: 'revpar', label: 'RevPAR', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
    { name: 'comp_set_revpar', label: 'Competitive-set RevPAR', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
  ],
};

/** Small clinics (T-068): visits and revenue by month, site and pseudonymous provider — never patients. */
export const CLINICS_PATIENT_VOLUME: TargetDefinition = {
  target: 'CLINICS_PATIENT_VOLUME',
  label: 'Patient volume',
  fileName: 'patient-volume.csv',
  people: 'PSEUDONYMOUS',
  refusesPeopleColumns: true,
  evidenceType: 'clinics.volume_month',
  recordIdField: 'month',
  recordIdFields: ['month', 'site', 'provider_ref'],
  observedAtFields: [],
  fields: [
    { name: 'month', label: 'Month', kind: 'text', required: true, hint: 'YYYY-MM.' },
    { name: 'site', label: 'Site', kind: 'text', required: true, hint: 'Clinic site.' },
    { name: 'provider_ref', label: 'Provider reference', kind: 'text', required: true, hint: 'A pseudonymous reference such as P07 — never a name or licence number.' },
    { name: 'visits', label: 'Visits', kind: 'decimal', required: true, hint: 'Visits in the month (a count; no patient detail).' },
    { name: 'revenue', label: 'Revenue', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
  ],
};

/** Small clinics (T-068): clinical equipment with acquisition date and useful life. */
export const CLINICS_EQUIPMENT: TargetDefinition = {
  target: 'CLINICS_EQUIPMENT',
  label: 'Equipment schedule',
  fileName: 'equipment-schedule.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'clinics.equipment',
  recordIdField: 'asset',
  recordIdFields: ['asset', 'site'],
  observedAtFields: [],
  fields: [
    { name: 'asset', label: 'Asset', kind: 'text', required: true, hint: 'e.g. Panoramic X-ray unit.' },
    { name: 'site', label: 'Site', kind: 'text', required: true, hint: 'Where it is installed.' },
    { name: 'acquired', label: 'Acquired', kind: 'date', required: true, hint: 'Acquisition or installation date.' },
    { name: 'useful_life_years', label: 'Useful life (years)', kind: 'decimal', required: true, hint: 'The manufacturer’s or the accounting useful life.' },
    { name: 'status', label: 'Status', kind: 'text', required: false, hint: 'e.g. in service.' },
  ],
};

/** Small clinics (T-068): share of visits coded at the highest complexity, by quarter, against policy. */
export const CLINICS_CODING_SUMMARY: TargetDefinition = {
  target: 'CLINICS_CODING_SUMMARY',
  label: 'Coding summary',
  fileName: 'coding-summary.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'clinics.coding_quarter',
  recordIdField: 'quarter',
  observedAtFields: [],
  fields: [
    { name: 'quarter', label: 'Quarter', kind: 'text', required: true, hint: 'e.g. 2026-Q3.' },
    { name: 'high_complexity_share', label: 'High-complexity share', kind: 'decimal', required: true, hint: 'A fraction of visits, e.g. 0.36.' },
    { name: 'policy_benchmark', label: 'Policy benchmark', kind: 'decimal', required: true, hint: 'The share the coding policy expects, e.g. 0.15.' },
  ],
};

/** Hospitals (T-069): admissions, patient days and average daily census by month and service line — aggregates. */
export const HOSPITALS_CENSUS: TargetDefinition = {
  target: 'HOSPITALS_CENSUS',
  label: 'Census',
  fileName: 'census.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'hospitals.census_month',
  recordIdField: 'month',
  recordIdFields: ['month', 'service_line'],
  observedAtFields: [],
  fields: [
    { name: 'month', label: 'Month', kind: 'text', required: true, hint: 'YYYY-MM.' },
    { name: 'service_line', label: 'Service line', kind: 'text', required: true, hint: 'e.g. Cardiology.' },
    { name: 'admissions', label: 'Admissions', kind: 'decimal', required: true, hint: 'A count; no patient detail.' },
    { name: 'patient_days', label: 'Patient days', kind: 'decimal', required: true, hint: 'Inpatient days in the month.' },
    { name: 'average_daily_census', label: 'Average daily census', kind: 'decimal', required: false, hint: 'Patient days ÷ days in the month.' },
  ],
};

/** Hospitals (T-069): gross charges and net revenue by month and payer. */
export const HOSPITALS_PAYER_MIX: TargetDefinition = {
  target: 'HOSPITALS_PAYER_MIX',
  label: 'Payer mix',
  fileName: 'payer-mix.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'hospitals.payer_month',
  recordIdField: 'month',
  recordIdFields: ['month', 'payer'],
  observedAtFields: [],
  fields: [
    { name: 'month', label: 'Month', kind: 'text', required: true, hint: 'YYYY-MM.' },
    { name: 'payer', label: 'Payer', kind: 'text', required: true, hint: 'Payer or programme; never a patient.' },
    { name: 'gross_charges', label: 'Gross charges', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
    { name: 'net_revenue', label: 'Net revenue', kind: 'money', required: true, hint: `After contractual allowances. ${IN_BASE_CURRENCY}` },
  ],
};

/**
 * Venture Raise (T-083): the cap table in a Carta/Pulley-like export shape,
 * one row per security. Holders are pseudonymous references and a holder
 * type — never names (rule 7).
 */
export const VENTURE_CAP_TABLE: TargetDefinition = {
  target: 'VENTURE_CAP_TABLE',
  label: 'Cap table',
  fileName: 'cap-table.csv',
  people: 'PSEUDONYMOUS',
  refusesPeopleColumns: true,
  evidenceType: 'venture.cap_table_row',
  recordIdField: 'security_id',
  observedAtFields: [],
  fields: [
    { name: 'security_id', label: 'Security id', kind: 'text', required: true, hint: 'The certificate, grant or instrument id, e.g. CS-1 or SAFE-2.' },
    { name: 'holder_ref', label: 'Holder reference', kind: 'text', required: true, hint: 'A pseudonymous reference such as F-1 or E-07 — never a name.' },
    { name: 'holder_type', label: 'Holder type', kind: 'code', required: true, hint: 'founder, employee, advisor, investor or pool.' },
    { name: 'instrument', label: 'Instrument', kind: 'code', required: true, hint: 'common, preferred, option, pool_unallocated, safe or note.' },
    { name: 'shares', label: 'Shares', kind: 'decimal', required: false, hint: 'Shares or options; empty for SAFEs and notes before they convert.' },
    { name: 'principal', label: 'Principal', kind: 'money', required: false, hint: `Amount invested on a SAFE or note. ${IN_BASE_CURRENCY}` },
    { name: 'valuation_cap', label: 'Valuation cap', kind: 'money', required: false, hint: `Post-money cap of a SAFE or note. ${IN_BASE_CURRENCY}` },
    { name: 'discount_pct', label: 'Discount (%)', kind: 'decimal', required: false, hint: 'Discount to the round price, in percent (e.g. 20).' },
    { name: 'mfn', label: 'Most-favoured-nation', kind: 'code', required: false, hint: 'yes when the SAFE takes better terms given later.' },
    { name: 'pro_rata', label: 'Pro-rata right', kind: 'code', required: false, hint: 'yes or no.' },
    { name: 'vesting', label: 'Subject to vesting', kind: 'code', required: false, hint: 'yes for founder or employee stock that vests.' },
    { name: 'issued_on', label: 'Issued on', kind: 'date', required: false, hint: 'Issue or signing date.' },
  ],
};

/** Venture Raise (T-083): cash and net burn by month, for runway. */
export const VENTURE_FINANCIALS: TargetDefinition = {
  target: 'VENTURE_FINANCIALS',
  label: 'Monthly financials',
  fileName: 'monthly-financials.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'venture.financials_month',
  recordIdField: 'month',
  observedAtFields: [],
  fields: [
    { name: 'month', label: 'Month', kind: 'text', required: true, hint: 'YYYY-MM.' },
    { name: 'cash_balance', label: 'Cash balance', kind: 'money', required: true, hint: `Bank balance at month end. ${IN_BASE_CURRENCY}` },
    { name: 'net_burn', label: 'Net burn', kind: 'money', required: true, hint: `Cash out minus cash in for the month (positive when burning). ${IN_BASE_CURRENCY}` },
  ],
};

/**
 * Music rights (T-140): the works and rights register. One row per work (a composition) or
 * recording (a master), with its identifiers and the year it was released. Writers are never
 * named here: splits carry pseudonymous writer references.
 */
export const MUSIC_WORKS: TargetDefinition = {
  target: 'MUSIC_WORKS',
  label: 'Works register',
  fileName: 'works-register.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'music.work',
  recordIdField: 'work_id',
  observedAtFields: [],
  fields: [
    { name: 'work_id', label: 'Work id', kind: 'text', required: true, hint: 'The catalog\'s own id for the work or recording, e.g. W-0042.' },
    { name: 'title', label: 'Title', kind: 'text', required: true, hint: 'The work\'s title as registered.' },
    { name: 'work_type', label: 'Work type', kind: 'code', required: true, hint: 'composition (publishing) or recording (master).' },
    { name: 'iswc', label: 'ISWC', kind: 'text', required: false, hint: 'International Standard Musical Work Code, for compositions.' },
    { name: 'isrc', label: 'ISRC', kind: 'text', required: false, hint: 'International Standard Recording Code, for recordings.' },
    { name: 'pro', label: 'PRO', kind: 'text', required: false, hint: 'Performing rights organisation the work is registered with, e.g. ASCAP, BMI, PRS.' },
    { name: 'publisher', label: 'Publisher or label', kind: 'text', required: false, hint: 'Who publishes the composition or releases the recording.' },
    { name: 'release_year', label: 'Release year', kind: 'decimal', required: true, hint: 'Year the work was first released; the catalog-age bands read it.' },
    { name: 'us_work', label: 'US work', kind: 'code', required: true, hint: 'yes when the grant is governed by US copyright law (termination rights apply), otherwise no.' },
  ],
};

/** Music rights (T-140): each writer's share of a work, from the split sheet or as a statement pays it. */
export const MUSIC_SPLITS: TargetDefinition = {
  target: 'MUSIC_SPLITS',
  label: 'Writer splits',
  fileName: 'writer-splits.csv',
  people: 'PSEUDONYMOUS',
  refusesPeopleColumns: true,
  evidenceType: 'music.split',
  recordIdField: 'split_id',
  observedAtFields: [],
  fields: [
    { name: 'split_id', label: 'Split id', kind: 'text', required: true, hint: 'Unique id of the split line.' },
    { name: 'work_id', label: 'Work id', kind: 'text', required: true, hint: 'The work, as in the works register.' },
    { name: 'writer_ref', label: 'Writer reference', kind: 'text', required: true, hint: 'A pseudonymous reference such as WR-014 — never a name or IPI number.' },
    { name: 'share_pct', label: 'Share (%)', kind: 'decimal', required: true, hint: 'The writer\'s share of the work, in percent.' },
    { name: 'source', label: 'Source', kind: 'code', required: true, hint: 'split_sheet (as signed) or statement (as the royalty statement pays it).' },
  ],
};

/**
 * Music rights (T-140): the chain of title — every registration, assignment, licence and
 * administration grant behind a work, with the dates the termination windows run from.
 */
export const MUSIC_TITLE_CHAIN: TargetDefinition = {
  target: 'MUSIC_TITLE_CHAIN',
  label: 'Chain of title',
  fileName: 'chain-of-title.csv',
  people: 'PSEUDONYMOUS',
  refusesPeopleColumns: true,
  evidenceType: 'music.grant',
  recordIdField: 'grant_id',
  observedAtFields: ['executed_on'],
  fields: [
    { name: 'grant_id', label: 'Grant id', kind: 'text', required: true, hint: 'Unique id of the registration or agreement line.' },
    { name: 'work_id', label: 'Work id', kind: 'text', required: true, hint: 'The work, as in the works register.' },
    { name: 'grant_type', label: 'Grant type', kind: 'code', required: true, hint: 'registration, assignment, license, administration or work_for_hire.' },
    { name: 'executed_on', label: 'Executed on', kind: 'date', required: false, hint: 'When the grant was signed (or the registration\'s effective date).' },
    { name: 'publication_date', label: 'Publication date', kind: 'date', required: false, hint: 'When the grant covers publication: the work\'s first publication under it.' },
    { name: 'copyright_secured_on', label: 'Copyright secured on', kind: 'date', required: false, hint: 'For works from before 1978: when copyright was first secured.' },
    { name: 'grantor_ref', label: 'Grantor reference', kind: 'text', required: false, hint: 'A pseudonymous reference to the author or prior owner, e.g. WR-014.' },
    { name: 'reference', label: 'Reference', kind: 'text', required: false, hint: 'Registration number or agreement reference.' },
  ],
};

/** Music rights (T-140): royalty statement lines — income by work, period and source. Absent periods stay absent. */
export const MUSIC_ROYALTY_STATEMENTS: TargetDefinition = {
  target: 'MUSIC_ROYALTY_STATEMENTS',
  label: 'Royalty statements',
  fileName: 'royalty-statements.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'music.royalty_line',
  recordIdField: 'line_id',
  observedAtFields: ['period_end'],
  fields: [
    { name: 'line_id', label: 'Line id', kind: 'text', required: true, hint: 'Unique id of the statement line.' },
    { name: 'period_end', label: 'Period end', kind: 'date', required: true, hint: 'Last day of the statement period.' },
    { name: 'work_id', label: 'Work id', kind: 'text', required: true, hint: 'The work, as in the works register.' },
    { name: 'income_source', label: 'Income source', kind: 'code', required: true, hint: 'performance, mechanical, sync, neighbouring or streaming.' },
    { name: 'payer', label: 'Payer', kind: 'text', required: false, hint: 'The society, administrator, label or licensee that paid.' },
    { name: 'amount', label: 'Net amount', kind: 'money', required: true, hint: `Net to the catalog owner (net publisher's share or net label share). ${IN_BASE_CURRENCY}` },
  ],
};

/**
 * Energy generation & rights (T-142): the plant register — one row per power plant, with its
 * capacity, fuel, age, capacity factor and power purchase agreement. Counterparties are businesses.
 */
export const ENERGY_PLANTS: TargetDefinition = {
  target: 'ENERGY_PLANTS',
  label: 'Plant register',
  fileName: 'plant-register.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'energy.plant',
  recordIdField: 'plant_id',
  observedAtFields: [],
  fields: [
    { name: 'plant_id', label: 'Plant id', kind: 'text', required: true, hint: 'The seller\'s own id for the plant, e.g. PL-001.' },
    { name: 'name', label: 'Plant name', kind: 'text', required: true, hint: 'The plant\'s name as the permits and agreements write it.' },
    { name: 'fuel', label: 'Fuel', kind: 'code', required: true, hint: 'coal, gas, wind, solar, hydro, storage or other.' },
    { name: 'capacity_mw', label: 'Net capacity (MW)', kind: 'decimal', required: true, hint: 'Net summer capacity in megawatts.' },
    { name: 'commissioned_year', label: 'Commissioned', kind: 'decimal', required: true, hint: 'Year the plant entered commercial operation.' },
    { name: 'capacity_factor_pct', label: 'Capacity factor (%)', kind: 'decimal', required: false, hint: 'Trailing-year net generation ÷ (capacity × hours), in percent, as the seller reports it.' },
    { name: 'ppa_counterparty', label: 'PPA counterparty', kind: 'text', required: false, hint: 'The offtaker under the power purchase agreement, if any.' },
    { name: 'ppa_expires_on', label: 'PPA expires on', kind: 'date', required: false, hint: 'When the power purchase agreement ends; blank when the plant sells merchant.' },
  ],
};

/**
 * Energy generation & rights (T-142): the oil & gas interest register — mineral, royalty and
 * working interests, each on a lease, with the decimal the division order pays.
 */
export const ENERGY_INTERESTS: TargetDefinition = {
  target: 'ENERGY_INTERESTS',
  label: 'Interest register',
  fileName: 'interest-register.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'energy.interest',
  recordIdField: 'interest_id',
  observedAtFields: [],
  fields: [
    { name: 'interest_id', label: 'Interest id', kind: 'text', required: true, hint: 'The seller\'s own id for the interest, e.g. OG-014.' },
    { name: 'name', label: 'Well or unit', kind: 'text', required: true, hint: 'The well, unit or tract the interest is in.' },
    { name: 'legal_description', label: 'Legal description', kind: 'text', required: false, hint: 'Section, township and range (or survey and abstract), as the title opinion writes it.' },
    { name: 'lease_id', label: 'Lease id', kind: 'text', required: true, hint: 'The lease, as in the lease schedule.' },
    { name: 'interest_type', label: 'Interest type', kind: 'code', required: true, hint: 'working, mineral or royalty.' },
    { name: 'interest_share', label: 'Interest share', kind: 'decimal', required: true, hint: 'The seller\'s share as a decimal: the working interest, or the share of the minerals or royalty owned (e.g. 0.5).' },
    { name: 'division_order_nri', label: 'Division-order decimal', kind: 'decimal', required: true, hint: 'The net revenue interest the division order pays, as a decimal (e.g. 0.09375).' },
    { name: 'operator', label: 'Operator', kind: 'text', required: false, hint: 'The operator of the well or unit.' },
  ],
};

/** Energy generation & rights (T-142): the lease schedule — acreage, the royalty chain, expiry and whether production holds it. */
export const ENERGY_LEASES: TargetDefinition = {
  target: 'ENERGY_LEASES',
  label: 'Lease schedule',
  fileName: 'lease-schedule.csv',
  people: 'PSEUDONYMOUS',
  refusesPeopleColumns: true,
  evidenceType: 'energy.lease',
  recordIdField: 'lease_id',
  observedAtFields: [],
  fields: [
    { name: 'lease_id', label: 'Lease id', kind: 'text', required: true, hint: 'Unique id of the lease.' },
    { name: 'lessor_ref', label: 'Lessor reference', kind: 'text', required: false, hint: 'A pseudonymous reference to the lessor, e.g. LR-031 — never a name.' },
    { name: 'net_acres', label: 'Net acres', kind: 'decimal', required: true, hint: 'Net mineral acres under the lease attributable to the interests.' },
    { name: 'royalty_rate', label: 'Lessor royalty', kind: 'decimal', required: true, hint: 'The lease royalty as a decimal (3/16 → 0.1875).' },
    { name: 'overriding_royalty', label: 'Overriding royalty', kind: 'decimal', required: false, hint: 'Overriding royalties burdening the working interest, as a decimal; blank for none.' },
    { name: 'effective_on', label: 'Effective on', kind: 'date', required: false, hint: 'When the lease took effect.' },
    { name: 'expires_on', label: 'Primary term ends', kind: 'date', required: false, hint: 'When the primary term ends, if production does not hold the lease.' },
    { name: 'held_by_production', label: 'Held by production', kind: 'code', required: true, hint: 'yes when production (or a unit) holds the lease past its primary term, otherwise no.' },
  ],
};

/**
 * Energy generation & rights (T-142): production history — volumes and gross revenue by asset,
 * period and product, with whether a plant's power sold under contract or merchant. Absent periods stay absent.
 */
export const ENERGY_PRODUCTION: TargetDefinition = {
  target: 'ENERGY_PRODUCTION',
  label: 'Production history',
  fileName: 'production-history.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'energy.production',
  recordIdField: 'record_id',
  observedAtFields: ['period_end'],
  fields: [
    { name: 'record_id', label: 'Record id', kind: 'text', required: true, hint: 'Unique id of the production line.' },
    { name: 'asset_id', label: 'Asset id', kind: 'text', required: true, hint: 'The plant or interest, as in the plant or interest register.' },
    { name: 'period_end', label: 'Period end', kind: 'date', required: true, hint: 'Last day of the production month.' },
    { name: 'product', label: 'Product', kind: 'code', required: true, hint: 'oil (bbl), gas (mcf), ngl (bbl) or power (MWh).' },
    { name: 'volume', label: 'Volume', kind: 'decimal', required: true, hint: 'Gross (8/8ths) volume for an interest; net generation for a plant.' },
    { name: 'gross_revenue', label: 'Gross revenue', kind: 'money', required: true, hint: `Revenue at 8/8ths for an interest; the plant's power revenue. ${IN_BASE_CURRENCY}` },
    { name: 'sales_type', label: 'Sold under', kind: 'code', required: false, hint: 'contracted (a PPA or hedge) or merchant, for a plant; blank for an interest.' },
  ],
};

/** Energy generation & rights (T-142): the seller's liability schedule — what the seller has booked for each obligation. */
export const ENERGY_LIABILITIES: TargetDefinition = {
  target: 'ENERGY_LIABILITIES',
  label: 'Liability schedule',
  fileName: 'liability-schedule.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'energy.liability',
  recordIdField: 'liability_id',
  observedAtFields: [],
  fields: [
    { name: 'liability_id', label: 'Liability id', kind: 'text', required: true, hint: 'Unique id of the schedule line.' },
    { name: 'asset_id', label: 'Asset id', kind: 'text', required: false, hint: 'The plant or interest it belongs to; blank for a portfolio-wide obligation.' },
    { name: 'kind', label: 'Obligation', kind: 'code', required: true, hint: 'remediation, ccr (coal ash closure), reclamation or aro (asset retirement / decommissioning).' },
    { name: 'description', label: 'Description', kind: 'text', required: false, hint: 'What the obligation is, as the schedule says.' },
    { name: 'booked_amount', label: 'Booked amount', kind: 'money', required: true, hint: `What the seller has booked for it. ${IN_BASE_CURRENCY}` },
  ],
};

/**
 * Multifamily syndication (T-106): the sponsor's prior deals, projected and
 * actual side by side. Blank actuals stay blank — absence is shown as absence,
 * never filled in. Deals, not people.
 */
export const SYNDICATION_TRACK_RECORD: TargetDefinition = {
  target: 'SYNDICATION_TRACK_RECORD',
  label: 'Sponsor track record',
  fileName: 'track-record.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'syndication.prior_deal',
  recordIdField: 'deal',
  observedAtFields: ['exited_on', 'acquired_on'],
  fields: [
    { name: 'deal', label: 'Prior deal', kind: 'text', required: true, hint: 'The property or fund, as the sponsor names it in its materials.' },
    { name: 'units', label: 'Units', kind: 'decimal', required: false, hint: 'Apartment units.' },
    { name: 'acquired_on', label: 'Acquired on', kind: 'date', required: false, hint: 'Closing date of the purchase.' },
    { name: 'exited_on', label: 'Exited on', kind: 'date', required: false, hint: 'Sale date; empty while held.' },
    { name: 'status', label: 'Status', kind: 'code', required: true, hint: 'realized or held.' },
    { name: 'projected_irr_pct', label: 'Projected IRR (%)', kind: 'decimal', required: false, hint: 'Investor IRR the offering projected, in percent.' },
    { name: 'actual_irr_pct', label: 'Actual IRR (%)', kind: 'decimal', required: false, hint: 'Investor IRR delivered, in percent; empty when not documented.' },
    { name: 'projected_multiple', label: 'Projected equity multiple', kind: 'decimal', required: false, hint: 'e.g. 1.85.' },
    { name: 'actual_multiple', label: 'Actual equity multiple', kind: 'decimal', required: false, hint: 'Empty when not documented.' },
  ],
};

/**
 * Regulatory & deal certainty (T-091): the merging parties' and rivals' sites
 * by local market — the input to the local-market concentration screen. Sales
 * and union status are per site (aggregates, never people).
 */
export const REGULATORY_FOOTPRINT: TargetDefinition = {
  target: 'REGULATORY_FOOTPRINT',
  label: 'Site footprint',
  fileName: 'footprint.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'regulatory.site',
  recordIdField: 'site_id',
  observedAtFields: [],
  fields: [
    { name: 'site_id', label: 'Site id', kind: 'text', required: true, hint: 'Unique id of the store, plant or facility.' },
    { name: 'party', label: 'Party', kind: 'code', required: true, hint: 'ACQUIRER, TARGET or RIVAL.' },
    { name: 'firm', label: 'Firm', kind: 'text', required: true, hint: 'The firm that owns the site (for rivals, their name).' },
    { name: 'market', label: 'Local market', kind: 'text', required: true, hint: 'The local market the site competes in.' },
    { name: 'region', label: 'Region', kind: 'text', required: true, hint: 'The wider region (for package coherence).' },
    { name: 'banner', label: 'Banner or brand', kind: 'text', required: true, hint: 'Trading banner or brand.' },
    { name: 'full_service', label: 'Full-service competitor', kind: 'code', required: true, hint: 'yes or no: whether the site competes in the relevant market.' },
    { name: 'sales', label: 'Annual sales', kind: 'decimal', required: true, hint: 'Annual sales of the site; shares are computed from it.' },
    { name: 'performance', label: 'Performance measure', kind: 'decimal', required: true, hint: 'e.g. EBITDA margin; used to compare divested and kept sites.' },
    { name: 'unionized', label: 'Unionized', kind: 'code', required: true, hint: 'yes or no.' },
    { name: 'cba_id', label: 'Bargaining agreement', kind: 'text', required: false, hint: 'The collective bargaining agreement covering the site, if any.' },
    { name: 'distribution_center', label: 'Distribution center', kind: 'text', required: true, hint: 'The distribution center that supplies the site.' },
    { name: 'systems', label: 'Store systems', kind: 'text', required: true, hint: 'The operating systems platform the site runs on.' },
  ],
};

/** Regulatory & deal certainty (T-091): the sites in a divestiture (remedy) package, by revision. */
export const REMEDY_PACKAGE: TargetDefinition = {
  target: 'REMEDY_PACKAGE',
  label: 'Divestiture package',
  fileName: 'remedy-package.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'regulatory.remedy_site',
  recordIdField: 'site_id',
  recordIdFields: ['revision', 'site_id'],
  observedAtFields: ['revision_date'],
  fields: [
    { name: 'revision', label: 'Package revision', kind: 'text', required: true, hint: 'The revision number of the package (1, 2, 3…).' },
    { name: 'revision_date', label: 'Revision date', kind: 'date', required: true, hint: 'When this revision was offered.' },
    { name: 'site_id', label: 'Site id', kind: 'text', required: true, hint: 'A site from the footprint.' },
    { name: 'buyer', label: 'Remedy buyer', kind: 'text', required: true, hint: 'Who would buy the divested sites.' },
    { name: 'distribution_center_transferred', label: 'Distribution center transferred', kind: 'code', required: true, hint: 'yes or no: whether the site\'s distribution center goes with it.' },
    { name: 'systems_transferred', label: 'Systems transferred', kind: 'code', required: true, hint: 'yes or no: whether the site\'s store systems go with it.' },
  ],
};

/** Imports every pack offers when its regulatory screen runs at full depth (T-091). */
/**
 * A profit and loss statement, line by line (Kumar, 2026-11-21): every pact can import one, whatever
 * its layout (months or years across, subtotals, title rows). One record per line per period; what each
 * account is comes from the mapping's line kinds, which a person confirms.
 */
export const FINANCIAL_PNL: TargetDefinition = {
  target: 'FINANCIAL_PNL',
  label: 'Profit and loss (P&L)',
  fileName: 'pnl.csv',
  people: 'NONE',
  refusesPeopleColumns: true,
  evidenceType: 'finance.pnl_line',
  recordIdField: 'account',
  recordIdFields: ['account', 'month'],
  observedAtFields: [],
  lineItems: true,
  fields: [
    // Plain words (Kumar, 2026-11-25): "Line name" and "Period", never "Account"; a statement by year is fine.
    { name: 'account', label: 'Line name', kind: 'text', required: true, hint: 'The name of each line, e.g. "Rent income" or "Insurance".' },
    { name: 'month', label: 'Period', kind: 'text', required: true, hint: 'The month (YYYY-MM) or the year (YYYY). When periods run across the columns, Pactlab reads them from the header.' },
    { name: 'amount', label: 'Amount', kind: 'money', required: true, hint: IN_BASE_CURRENCY },
  ],
};

/** Imports every pact offers, whatever its pack. */
export const CORE_IMPORT_TARGETS = ['FINANCIAL_PNL'] as const satisfies readonly ImportTarget[];

export const REGULATORY_TARGETS = ['REGULATORY_FOOTPRINT', 'REMEDY_PACKAGE'] as const satisfies readonly ImportTarget[];

export const IMPORT_TARGET_DEFINITIONS: Readonly<Record<ImportTarget, TargetDefinition>> = {
  BILLING_INVOICE_LINE,
  FINTECH_LOAN_TAPE,
  FINTECH_AML_ALERT,
  FINTECH_PROCESSOR_VOLUME,
  FINTECH_LICENCES,
  MULTIFAMILY_RENT_ROLL,
  MULTIFAMILY_T12,
  MULTIFAMILY_DELINQUENCY,
  MULTIFAMILY_INSPECTION,
  HEALTHCARE_CLAIMS_SUMMARY,
  HEALTHCARE_PROVIDER_ROSTER,
  TELECOM_SUBSCRIBERS,
  SERVICES_TIMESHEETS,
  SERVICES_HEADCOUNT,
  PHARMA_PATENTS,
  PHARMA_PIPELINE,
  ECOMMERCE_COHORTS,
  ECOMMERCE_AD_SPEND,
  CRE_RENT_ROLL,
  CRE_CAM_RECONCILIATION,
  HOTELS_OPERATING_HISTORY,
  HOTELS_STR_BENCHMARK,
  CLINICS_PATIENT_VOLUME,
  CLINICS_EQUIPMENT,
  CLINICS_CODING_SUMMARY,
  HOSPITALS_CENSUS,
  HOSPITALS_PAYER_MIX,
  VENTURE_CAP_TABLE,
  VENTURE_FINANCIALS,
  SYNDICATION_TRACK_RECORD,
  MUSIC_WORKS,
  MUSIC_SPLITS,
  MUSIC_TITLE_CHAIN,
  MUSIC_ROYALTY_STATEMENTS,
  ENERGY_PLANTS,
  ENERGY_INTERESTS,
  ENERGY_LEASES,
  ENERGY_PRODUCTION,
  ENERGY_LIABILITIES,
  REGULATORY_FOOTPRINT,
  REMEDY_PACKAGE,
  FINANCIAL_PNL,
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
