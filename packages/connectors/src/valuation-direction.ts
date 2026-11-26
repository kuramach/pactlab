import type { FindingDomain, ValuationDirection } from '@pactlab/domain';
import { CODE_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE, ISSUE_LINK_EVIDENCE_TYPE, PULL_REQUEST_EVIDENCE_TYPE, REPOSITORY_HEAD_EVIDENCE_TYPE } from './github/evidence';
import { DELIVERY_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE, JIRA_ISSUE_EVIDENCE_TYPE, JIRA_SPRINT_EVIDENCE_TYPE } from './jira/evidence';
import { DEPENDENCY_ALERT_EVIDENCE_TYPE } from './mcp/evidence-types';
import { INVOICE_LINE_EVIDENCE_TYPE } from './stripe/invoice-line';

/**
 * How a signal reaches valuation:
 * - PRICED_TERM: a drag priced as a price reduction, remediation cost,
 *   escrow or indemnity, which feeds the seller-facing negotiation position;
 * - ASSUMPTION: a drag that haircuts a scenario assumption (e.g. growth);
 * - CONFIRMATION: a cushion, recorded as value confirmed, never price paid;
 * - INFORMATIONAL: neutral by design, with a stated rationale.
 */
export type DirectionChannel = 'PRICED_TERM' | 'ASSUMPTION' | 'CONFIRMATION' | 'INFORMATIONAL';

export interface DirectionRule {
  readonly signal: string;
  readonly findingDomain: FindingDomain | 'FINANCIAL' | 'CONTRACT';
  readonly defaultDirection: ValuationDirection;
  readonly channel: DirectionChannel;
  /** Required for neutral (0) rules: neutral is a decision, never missing data. */
  readonly rationale?: string;
}

/** AI document findings (from the data room) — keyed by the clause kinds contract extraction emits. */
export const DOCUMENT_FINDING_EVIDENCE_TYPE = 'document.finding';
/** Reference figures and conversion inputs used by the metrics engine. */
export const MANAGEMENT_KPI_EVIDENCE_TYPE = 'management.kpi';
export const FX_RATE_EVIDENCE_TYPE = 'fx.rate';
/** Venture Raise (T-083): the founder's cap table and monthly cash, imported as pack extracts. */
export const VENTURE_CAP_TABLE_EVIDENCE_TYPE = 'venture.cap_table_row';
export const VENTURE_FINANCIALS_EVIDENCE_TYPE = 'venture.financials_month';
/** Fintech (T-058, T-159): the loan tape, AML alerts, processor exports and the licence register, imported as pack extracts. */
export const FINTECH_LOAN_EVIDENCE_TYPE = 'fintech.loan';
export const FINTECH_AML_ALERT_EVIDENCE_TYPE = 'fintech.aml_alert';
export const FINTECH_PROCESSOR_MONTH_EVIDENCE_TYPE = 'fintech.processor_month';
export const FINTECH_LICENCE_EVIDENCE_TYPE = 'fintech.licence';
/** The imported P&L (ADR 0038), read across years by the trend rules (Kumar, 2026-11-26 — every pack). */
export const PNL_LINE_EVIDENCE_TYPE = 'finance.pnl_line';
/** Healthcare services (T-160): remittances, collections by clinician and the credentialing and payer contract registers. */
export const HEALTHCARE_REMITTANCE_MONTH_EVIDENCE_TYPE = 'healthcare.remittance_month';
export const HEALTHCARE_CLINICIAN_MONTH_EVIDENCE_TYPE = 'healthcare.clinician_month';
export const HEALTHCARE_CREDENTIAL_EVIDENCE_TYPE = 'healthcare.credential';
export const HEALTHCARE_PAYER_CONTRACT_EVIDENCE_TYPE = 'healthcare.payer_contract';
/** Small clinics (T-161): collections and direct costs by service line and provider, and visits by referral source. */
export const CLINICS_SERVICE_LINE_MONTH_EVIDENCE_TYPE = 'clinics.service_line_month';
export const CLINICS_REFERRAL_MONTH_EVIDENCE_TYPE = 'clinics.referral_month';
/** Pharma and biotech (T-064, T-163): the pipeline schedule, trial-registry records, patent schedule, obligations model and R&D roster. */
export const PHARMA_PROGRAMME_EVIDENCE_TYPE = 'pharma.programme';
export const PHARMA_REGISTRY_TRIAL_EVIDENCE_TYPE = 'pharma.registry_trial';
export const PHARMA_PATENT_EVIDENCE_TYPE = 'pharma.patent';
export const PHARMA_OBLIGATION_EVIDENCE_TYPE = 'pharma.obligation';
export const PHARMA_SCIENTIST_EVIDENCE_TYPE = 'pharma.scientist';

/**
 * Every evidence type the adapters and engines emit, with the direction each
 * of its signals proposes. Proposals only: a person confirms or overrides the
 * direction when accepting a finding. There is no price-increase channel —
 * clean diligence confirms the thesis; it never raises the price.
 */
export const VALUATION_DIRECTION_MAP: Readonly<Record<string, readonly DirectionRule[]>> = {
  [REPOSITORY_HEAD_EVIDENCE_TYPE]: [
    { signal: 'ghost-commit', findingDomain: 'CODE_PROVENANCE', defaultDirection: -1, channel: 'PRICED_TERM' },
    { signal: 'key-person', findingDomain: 'KEY_PERSON', defaultDirection: -1, channel: 'PRICED_TERM' },
    { signal: 'scan', findingDomain: 'SECURITY', defaultDirection: -1, channel: 'PRICED_TERM' },
    { signal: 'healthy-ownership', findingDomain: 'KEY_PERSON', defaultDirection: 1, channel: 'CONFIRMATION' },
  ],
  [PULL_REQUEST_EVIDENCE_TYPE]: [
    { signal: 'unreviewed-merges', findingDomain: 'OPERATIONS', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'failing-checks', findingDomain: 'OPERATIONS', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'healthy-review', findingDomain: 'OPERATIONS', defaultDirection: 1, channel: 'CONFIRMATION' },
  ],
  [ISSUE_LINK_EVIDENCE_TYPE]: [
    {
      signal: 'traceability',
      findingDomain: 'OPERATIONS',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'Links code to delivery work so other findings can cite both; a link moves no value by itself.',
    },
  ],
  // Read through an MCP server (T-084c). An open alert is remediation work the buyer prices;
  // a closed one is history.
  [DEPENDENCY_ALERT_EVIDENCE_TYPE]: [
    { signal: 'open-vulnerability', findingDomain: 'SECURITY', defaultDirection: -1, channel: 'PRICED_TERM' },
    {
      signal: 'resolved-vulnerability',
      findingDomain: 'SECURITY',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'A fixed or dismissed alert is patching history; it moves no value by itself.',
    },
  ],
  [JIRA_ISSUE_EVIDENCE_TYPE]: [
    { signal: 'reopen-rate', findingDomain: 'OPERATIONS', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'strong-delivery', findingDomain: 'OPERATIONS', defaultDirection: 1, channel: 'CONFIRMATION' },
  ],
  [JIRA_SPRINT_EVIDENCE_TYPE]: [
    { signal: 'velocity-shortfall', findingDomain: 'OPERATIONS', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'strong-delivery', findingDomain: 'OPERATIONS', defaultDirection: 1, channel: 'CONFIRMATION' },
  ],
  [INVOICE_LINE_EVIDENCE_TYPE]: [
    { signal: 'arr-below-reported', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'PRICED_TERM' },
    { signal: 'arr-above-reported', findingDomain: 'FINANCIAL', defaultDirection: 1, channel: 'CONFIRMATION' },
    { signal: 'customer-concentration', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'PRICED_TERM' },
  ],
  [CODE_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE]: [
    {
      signal: 'contributor-profile',
      findingDomain: 'KEY_PERSON',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'Profiles inform retention planning; key-person drags come from findings.',
    },
  ],
  [DELIVERY_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE]: [
    {
      signal: 'contributor-profile',
      findingDomain: 'KEY_PERSON',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'Profiles inform retention planning; key-person drags come from findings.',
    },
  ],
  [MANAGEMENT_KPI_EVIDENCE_TYPE]: [
    {
      signal: 'reported-figure',
      findingDomain: 'FINANCIAL',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'A reference figure for reconciliation; the reconciled difference carries the direction.',
    },
  ],
  [FX_RATE_EVIDENCE_TYPE]: [
    {
      signal: 'conversion-rate',
      findingDomain: 'FINANCIAL',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'A conversion input; it moves no value by itself.',
    },
  ],
  // Founder-side: −1 is what an investor will find and price; +1 is confirmed value the founder keeps confidential.
  [VENTURE_CAP_TABLE_EVIDENCE_TYPE]: [
    { signal: 'cap-table-mismatch', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'PRICED_TERM' },
    { signal: 'safe-stack', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'missing-83b', findingDomain: 'CONTRACT', defaultDirection: -1, channel: 'PRICED_TERM' },
    { signal: 'cap-table-reconciles', findingDomain: 'FINANCIAL', defaultDirection: 1, channel: 'CONFIRMATION' },
  ],
  [VENTURE_FINANCIALS_EVIDENCE_TYPE]: [
    { signal: 'runway-short', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    {
      signal: 'cash-position',
      findingDomain: 'FINANCIAL',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'Cash and burn inform the raise’s timing; only a contradicted runway claim moves the round.',
    },
  ],
  // Fintech (T-159, ADR 0050). Claims and loss rates are recomputed from the processor exports; licences are read at the analysis date.
  [FINTECH_PROCESSOR_MONTH_EVIDENCE_TYPE]: [
    { signal: 'claim-contradicted', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'claim-verified', findingDomain: 'FINANCIAL', defaultDirection: 1, channel: 'CONFIRMATION' },
    {
      signal: 'claim-unverified',
      findingDomain: 'FINANCIAL',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'A claim nothing in the evidence checks is a gap to close, neither priced nor relied on.',
    },
    { signal: 'revenue-unreconciled', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'loss-threshold-breach', findingDomain: 'REGULATORY', defaultDirection: -1, channel: 'PRICED_TERM' },
    {
      signal: 'loss-rate-rising',
      findingDomain: 'REGULATORY',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'Within the stated threshold: a watch item and a covenant to keep, not a price adjustment.',
    },
    {
      signal: 'compliance-gap',
      findingDomain: 'REGULATORY',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'Absent or stale compliance evidence, or a consent order for counsel to read: requested and reviewed, never priced as if known.',
    },
  ],
  [FINTECH_LICENCE_EVIDENCE_TYPE]: [
    { signal: 'licence-lapsed', findingDomain: 'REGULATORY', defaultDirection: -1, channel: 'PRICED_TERM' },
    {
      signal: 'licence-near-expiry',
      findingDomain: 'REGULATORY',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'A closing condition (renewal before close), not a price adjustment.',
    },
  ],
  [FINTECH_LOAN_EVIDENCE_TYPE]: [{ signal: 'allowance-shortfall', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'PRICED_TERM' }],
  [FINTECH_AML_ALERT_EVIDENCE_TYPE]: [{ signal: 'unreviewed-alerts', findingDomain: 'REGULATORY', defaultDirection: -1, channel: 'PRICED_TERM' }],
  [PNL_LINE_EVIDENCE_TYPE]: [
    {
      signal: 'trend',
      findingDomain: 'FINANCIAL',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'A record of the multi-year trend for review; drifts and expenses outpacing revenue carry their own direction.',
    },
    { signal: 'margin-drift', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'expense-outpacing', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    // R&D flat across the imported years while a document says the timeline was brought forward (T-163).
    { signal: 'rd-flat-timeline-accelerated', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
  ],
  // Healthcare services (T-160, ADR 0051). Payer mix, denials and days in AR are recomputed from the remittances;
  // credentials and payer contracts are read at the analysis date. Dates and arithmetic only, never a clinical or legal judgment.
  [HEALTHCARE_REMITTANCE_MONTH_EVIDENCE_TYPE]: [
    { signal: 'claim-contradicted', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'claim-verified', findingDomain: 'FINANCIAL', defaultDirection: 1, channel: 'CONFIRMATION' },
    {
      signal: 'claim-unverified',
      findingDomain: 'FINANCIAL',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'A claim nothing in the evidence checks is a gap to close, neither priced nor relied on.',
    },
    { signal: 'collections-unreconciled', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'denial-rate-rising', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'days-in-ar-rising', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'payer-mix-shift', findingDomain: 'COMMERCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    {
      signal: 'compliance-gap',
      findingDomain: 'REGULATORY',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'Stale or absent compliance evidence is requested and reviewed before close, never priced as if its contents were known.',
    },
  ],
  [HEALTHCARE_CREDENTIAL_EVIDENCE_TYPE]: [
    { signal: 'practising-expired', findingDomain: 'REGULATORY', defaultDirection: -1, channel: 'PRICED_TERM' },
    {
      signal: 'credential-lapsed',
      findingDomain: 'REGULATORY',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'An expired credential with no collections after its expiry: renewal or removal from the roster as a closing condition, not a price adjustment.',
    },
    {
      signal: 'credential-near-expiry',
      findingDomain: 'REGULATORY',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'A closing condition (renewal before close), not a price adjustment.',
    },
    {
      signal: 'credential-missing',
      findingDomain: 'REGULATORY',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'No licence on file for a rostered clinician: evidence to request, not a defect to price.',
    },
  ],
  [HEALTHCARE_CLINICIAN_MONTH_EVIDENCE_TYPE]: [{ signal: 'clinician-concentration', findingDomain: 'PEOPLE', defaultDirection: -1, channel: 'PRICED_TERM' }],
  [HEALTHCARE_PAYER_CONTRACT_EVIDENCE_TYPE]: [
    { signal: 'contract-expired', findingDomain: 'COMMERCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    {
      signal: 'contract-expiring',
      findingDomain: 'COMMERCIAL',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'A renegotiation inside the hold: a scenario sensitivity and a closing deliverable, not a price adjustment.',
    },
    {
      signal: 'contract-missing',
      findingDomain: 'COMMERCIAL',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'A payer remitting with no contract on the register: evidence to request, not a defect to price.',
    },
  ],
  // Small clinics (T-161, ADR 0052): the owner-operator's share and each service line's providers recomputed from the
  // schedule and billing exports; visits by referral source. Retention and volume risks, never a ranking or a legal view.
  [CLINICS_SERVICE_LINE_MONTH_EVIDENCE_TYPE]: [
    { signal: 'owner-sole-provider', findingDomain: 'PEOPLE', defaultDirection: -1, channel: 'PRICED_TERM' },
    { signal: 'owner-no-succession', findingDomain: 'PEOPLE', defaultDirection: -1, channel: 'PRICED_TERM' },
  ],
  [CLINICS_REFERRAL_MONTH_EVIDENCE_TYPE]: [{ signal: 'referral-concentration', findingDomain: 'COMMERCIAL', defaultDirection: -1, channel: 'ASSUMPTION' }],
  // Pharma and biotech (T-163, ADR 0053): consistency between the pipeline's claims and the filings, patent dates
  // against the hold, the agreements' payments against the seller's model. Never a view on efficacy or approvability.
  [PHARMA_PROGRAMME_EVIDENCE_TYPE]: [
    { signal: 'claim-contradicted', findingDomain: 'REGULATORY', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'claim-verified', findingDomain: 'REGULATORY', defaultDirection: 1, channel: 'CONFIRMATION' },
    {
      signal: 'claim-unverified',
      findingDomain: 'REGULATORY',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'A phase or timeline claim no registry record or correspondence bears on is a gap to close, neither priced nor relied on.',
    },
  ],
  [PHARMA_REGISTRY_TRIAL_EVIDENCE_TYPE]: [{ signal: 'trials-halted', findingDomain: 'REGULATORY', defaultDirection: -1, channel: 'ASSUMPTION' }],
  [PHARMA_PATENT_EVIDENCE_TYPE]: [{ signal: 'patent-cliff-in-hold', findingDomain: 'LEGAL', defaultDirection: -1, channel: 'PRICED_TERM' }],
  [PHARMA_OBLIGATION_EVIDENCE_TYPE]: [
    { signal: 'obligation-omitted', findingDomain: 'LEGAL', defaultDirection: -1, channel: 'PRICED_TERM' },
    { signal: 'obligation-understated', findingDomain: 'LEGAL', defaultDirection: -1, channel: 'PRICED_TERM' },
    { signal: 'royalty-rate-understated', findingDomain: 'LEGAL', defaultDirection: -1, channel: 'ASSUMPTION' },
  ],
  [PHARMA_SCIENTIST_EVIDENCE_TYPE]: [{ signal: 'key-scientist-concentration', findingDomain: 'PEOPLE', defaultDirection: -1, channel: 'PRICED_TERM' }],
  [DOCUMENT_FINDING_EVIDENCE_TYPE]: [
    // A product one manufacturer makes, with no second source described (T-163).
    {
      signal: 'single-source-manufacturing',
      findingDomain: 'OPERATIONAL',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'A supply-continuity covenant or second-source qualification as a closing or post-close deliverable, not a price adjustment.',
    },
    // The clinic lease as read sentence by sentence (T-161): a short term with no renewal is relocation or
    // renegotiation risk the reviewer prices; consent to assign is a closing condition.
    { signal: 'lease-short-term', findingDomain: 'PROPERTY', defaultDirection: -1, channel: 'PRICED_TERM' },
    {
      signal: 'lease-assignment-consent',
      findingDomain: 'PROPERTY',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'The landlord’s consent to assign (or a new lease) is a closing condition, not a price adjustment.',
    },
    { signal: 'CHANGE_OF_CONTROL', findingDomain: 'CONTRACT', defaultDirection: -1, channel: 'PRICED_TERM' },
    { signal: 'ASSIGNMENT', findingDomain: 'CONTRACT', defaultDirection: -1, channel: 'PRICED_TERM' },
    { signal: 'EXCLUSIVITY', findingDomain: 'CONTRACT', defaultDirection: -1, channel: 'PRICED_TERM' },
    { signal: 'INDEMNITY', findingDomain: 'CONTRACT', defaultDirection: -1, channel: 'PRICED_TERM' },
    { signal: 'TERMINATION_FOR_CONVENIENCE', findingDomain: 'CONTRACT', defaultDirection: -1, channel: 'PRICED_TERM' },
    { signal: 'AUTO_RENEWAL', findingDomain: 'CONTRACT', defaultDirection: 1, channel: 'CONFIRMATION' },
    {
      signal: 'LIMITATION_OF_LIABILITY',
      findingDomain: 'CONTRACT',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'A standard cap; it moves value only when unusual, which a reviewer records as a drag.',
    },
  ],
};

/** Evidence types the connector adapters emit (the contract test checks each is mapped). */
export const ADAPTER_EVIDENCE_TYPES = [
  REPOSITORY_HEAD_EVIDENCE_TYPE,
  CODE_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE,
  PULL_REQUEST_EVIDENCE_TYPE,
  ISSUE_LINK_EVIDENCE_TYPE,
  DEPENDENCY_ALERT_EVIDENCE_TYPE,
  JIRA_ISSUE_EVIDENCE_TYPE,
  JIRA_SPRINT_EVIDENCE_TYPE,
  DELIVERY_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE,
  INVOICE_LINE_EVIDENCE_TYPE,
  VENTURE_CAP_TABLE_EVIDENCE_TYPE,
  VENTURE_FINANCIALS_EVIDENCE_TYPE,
  FINTECH_LOAN_EVIDENCE_TYPE,
  FINTECH_AML_ALERT_EVIDENCE_TYPE,
  FINTECH_PROCESSOR_MONTH_EVIDENCE_TYPE,
  FINTECH_LICENCE_EVIDENCE_TYPE,
  PNL_LINE_EVIDENCE_TYPE,
  HEALTHCARE_REMITTANCE_MONTH_EVIDENCE_TYPE,
  HEALTHCARE_CLINICIAN_MONTH_EVIDENCE_TYPE,
  HEALTHCARE_CREDENTIAL_EVIDENCE_TYPE,
  HEALTHCARE_PAYER_CONTRACT_EVIDENCE_TYPE,
  CLINICS_SERVICE_LINE_MONTH_EVIDENCE_TYPE,
  CLINICS_REFERRAL_MONTH_EVIDENCE_TYPE,
  PHARMA_PROGRAMME_EVIDENCE_TYPE,
  PHARMA_REGISTRY_TRIAL_EVIDENCE_TYPE,
  PHARMA_PATENT_EVIDENCE_TYPE,
  PHARMA_OBLIGATION_EVIDENCE_TYPE,
  PHARMA_SCIENTIST_EVIDENCE_TYPE,
] as const;

/** The default direction for one signal, or null when the map does not know it. */
export function defaultDirectionFor(evidenceType: string, signal: string): ValuationDirection | null {
  return VALUATION_DIRECTION_MAP[evidenceType]?.find((rule) => rule.signal === signal)?.defaultDirection ?? null;
}
