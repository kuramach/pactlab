import type { FindingDomain, ValuationDirection } from '../findings/types';

/**
 * Quality of earnings (T-135): the platform-prepared adjusted-EBITDA schedule, the seller's
 * add-back register and the working-capital analysis. This file is the registry: every
 * adjustment category, add-back status and working-capital component, and the valuation
 * direction each QoE signal proposes. Pactlab is not a QoE firm; the work product is analysis
 * for the buyer's own review and their advisors.
 */

/** Normalization categories. Adding one without a registry row fails the build (`satisfies` below). */
export const QOE_ADJUSTMENT_CATEGORIES = [
  'OWNER_COMPENSATION',
  'NON_RECURRING',
  'RELATED_PARTY',
  'RENT_NORMALIZATION',
  'PRO_FORMA_ACQUISITION',
  'PRO_FORMA_LOCATION',
  'PRO_FORMA_CONTRACT',
  'OTHER',
] as const;
export type QoeAdjustmentCategory = (typeof QOE_ADJUSTMENT_CATEGORIES)[number];

export interface QoeCategoryDefinition {
  readonly label: string;
  readonly description: string;
}

export const QOE_CATEGORY_REGISTRY = {
  OWNER_COMPENSATION: { label: 'Owner and executive compensation', description: 'Owner or executive pay brought to what the role would cost at market after close.' },
  NON_RECURRING: { label: 'One-time and non-recurring items', description: 'Costs or income that will not recur: litigation, a one-off project, a disposal gain.' },
  RELATED_PARTY: { label: 'Related-party transactions', description: 'Dealings with owners or their affiliates restated at arm’s-length terms.' },
  RENT_NORMALIZATION: { label: 'Rent normalization', description: 'Rent paid to a related landlord, or below or above market, brought to market rent.' },
  PRO_FORMA_ACQUISITION: { label: 'Pro forma: acquisitions', description: 'A full year of an acquired business the period only partly includes.' },
  PRO_FORMA_LOCATION: { label: 'Pro forma: new locations', description: 'A full year of locations opened during the period.' },
  PRO_FORMA_CONTRACT: { label: 'Pro forma: new or lost contracts', description: 'A full year of a contract won or lost during the period.' },
  OTHER: { label: 'Other normalization', description: 'Any other normalization; the rationale must say what and why.' },
} as const satisfies Record<QoeAdjustmentCategory, QoeCategoryDefinition>;

/** Said vs observed: the register's status column is the distinction, carried into the report. */
export const QOE_VERIFICATION_STATUSES = ['VERIFIED', 'PARTIALLY_VERIFIED', 'UNVERIFIED'] as const;
export type QoeVerificationStatus = (typeof QOE_VERIFICATION_STATUSES)[number];
export const QOE_VERIFICATION_LABELS = { VERIFIED: 'Verified', PARTIALLY_VERIFIED: 'Partially verified', UNVERIFIED: 'Unverified' } as const satisfies Record<QoeVerificationStatus, string>;

export const QOE_RECURRENCE = ['RECURRING', 'ONE_OFF'] as const;
export type QoeRecurrence = (typeof QOE_RECURRENCE)[number];

/** A reviewer's explicit call on an add-back; without one, the status decides (see `addBackCounts`). */
export const QOE_INCLUSION_DECISIONS = ['INCLUDE', 'EXCLUDE'] as const;
export type QoeInclusionDecision = (typeof QOE_INCLUSION_DECISIONS)[number];

/**
 * Whether an add-back counts in adjusted EBITDA, and at which figure. Unverified add-backs are
 * excluded by default; only a recorded INCLUDE decision brings one in (at the claimed amount).
 * A verified add-back counts at its claimed amount, a partially verified one at the verified
 * amount, unless a reviewer excluded it.
 */
export function addBackCounts(status: QoeVerificationStatus, decision: QoeInclusionDecision | null): { counts: boolean; basis: 'CLAIMED' | 'VERIFIED' | null } {
  if (decision === 'EXCLUDE') return { counts: false, basis: null };
  if (status === 'UNVERIFIED') return decision === 'INCLUDE' ? { counts: true, basis: 'CLAIMED' } : { counts: false, basis: null };
  return { counts: true, basis: status === 'VERIFIED' ? 'CLAIMED' : 'VERIFIED' };
}

/** Working-capital components: debt-free, cash-free, so cash and debt are never components. */
export const QOE_WORKING_CAPITAL_COMPONENTS = [
  'RECEIVABLES',
  'INVENTORY',
  'PREPAID_EXPENSES',
  'OTHER_CURRENT_ASSETS',
  'PAYABLES',
  'ACCRUED_LIABILITIES',
  'DEFERRED_REVENUE',
  'OTHER_CURRENT_LIABILITIES',
] as const;
export type QoeWorkingCapitalComponent = (typeof QOE_WORKING_CAPITAL_COMPONENTS)[number];

export const QOE_COMPONENT_REGISTRY = {
  RECEIVABLES: { label: 'Accounts receivable', side: 'ASSET' },
  INVENTORY: { label: 'Inventory', side: 'ASSET' },
  PREPAID_EXPENSES: { label: 'Prepaid expenses', side: 'ASSET' },
  OTHER_CURRENT_ASSETS: { label: 'Other current assets', side: 'ASSET' },
  PAYABLES: { label: 'Accounts payable', side: 'LIABILITY' },
  ACCRUED_LIABILITIES: { label: 'Accrued liabilities', side: 'LIABILITY' },
  DEFERRED_REVENUE: { label: 'Deferred revenue', side: 'LIABILITY' },
  OTHER_CURRENT_LIABILITIES: { label: 'Other current liabilities', side: 'LIABILITY' },
} as const satisfies Record<QoeWorkingCapitalComponent, { label: string; side: 'ASSET' | 'LIABILITY' }>;

// --- How QoE reaches valuation ---------------------------------------------------------------

/** Evidence types the QoE work product cites; each has direction rules below. */
export const QOE_ADJUSTMENT_EVIDENCE_TYPE = 'qoe.adjustment';
export const QOE_ADD_BACK_EVIDENCE_TYPE = 'qoe.add_back';
export const QOE_WORKING_CAPITAL_EVIDENCE_TYPE = 'qoe.working_capital';

/** The same shape as the connectors' VALUATION_DIRECTION_MAP rules. */
export interface QoeDirectionRule {
  readonly signal: string;
  readonly findingDomain: FindingDomain;
  readonly defaultDirection: ValuationDirection;
  readonly channel: 'PRICED_TERM' | 'ASSUMPTION' | 'CONFIRMATION' | 'INFORMATIONAL';
  readonly rationale?: string;
}

/**
 * The only way a QoE figure reaches the bridge: each adjustment and add-back is drafted as a
 * finding whose direction comes from these rules; a person accepts and prices it, and only then
 * does it move a scenario. A normalization that raises EBITDA is confirmed value, never price
 * paid. The working-capital peg is a deal term (a true-up mechanic), never a bridge line.
 */
export const QOE_DIRECTION_MAP: Readonly<Record<string, readonly QoeDirectionRule[]>> = {
  [QOE_ADJUSTMENT_EVIDENCE_TYPE]: [
    { signal: 'reduces-ebitda', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'increases-ebitda', findingDomain: 'FINANCIAL', defaultDirection: 1, channel: 'CONFIRMATION' },
  ],
  [QOE_ADD_BACK_EVIDENCE_TYPE]: [
    { signal: 'UNVERIFIED', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'PARTIALLY_VERIFIED', findingDomain: 'FINANCIAL', defaultDirection: -1, channel: 'ASSUMPTION' },
    { signal: 'VERIFIED', findingDomain: 'FINANCIAL', defaultDirection: 1, channel: 'CONFIRMATION' },
  ],
  [QOE_WORKING_CAPITAL_EVIDENCE_TYPE]: [
    {
      signal: 'peg',
      findingDomain: 'FINANCIAL',
      defaultDirection: 0,
      channel: 'INFORMATIONAL',
      rationale: 'The peg sets a closing true-up through the deal terms; it never moves the bridge by itself.',
    },
  ],
};

/** The direction a QoE signal proposes; throws on an unmapped signal so nothing reaches valuation unmapped. */
export function qoeDirectionFor(evidenceType: string, signal: string): QoeDirectionRule {
  const rule = QOE_DIRECTION_MAP[evidenceType]?.find((entry) => entry.signal === signal);
  if (!rule) throw new Error(`QoE signal ${evidenceType}/${signal} has no direction rule`);
  return rule;
}

/** The label the schedule and report carry: Pactlab is not a QoE firm. */
export const QOE_DISCLAIMER =
  'Platform-prepared analysis for the buyer’s own review and their advisors. Pactlab is not a quality-of-earnings firm and does not issue an independent QoE opinion.';
