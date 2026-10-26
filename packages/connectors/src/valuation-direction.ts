import type { FindingDomain, ValuationDirection } from '@pactlab/domain';
import { CODE_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE, REPOSITORY_HEAD_EVIDENCE_TYPE } from './github/evidence';
import { DELIVERY_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE, JIRA_ISSUE_EVIDENCE_TYPE, JIRA_SPRINT_EVIDENCE_TYPE } from './jira/evidence';
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
  [DOCUMENT_FINDING_EVIDENCE_TYPE]: [
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
  JIRA_ISSUE_EVIDENCE_TYPE,
  JIRA_SPRINT_EVIDENCE_TYPE,
  DELIVERY_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE,
  INVOICE_LINE_EVIDENCE_TYPE,
  VENTURE_CAP_TABLE_EVIDENCE_TYPE,
  VENTURE_FINANCIALS_EVIDENCE_TYPE,
] as const;

/** The default direction for one signal, or null when the map does not know it. */
export function defaultDirectionFor(evidenceType: string, signal: string): ValuationDirection | null {
  return VALUATION_DIRECTION_MAP[evidenceType]?.find((rule) => rule.signal === signal)?.defaultDirection ?? null;
}
