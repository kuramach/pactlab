/**
 * Multifamily syndication (T-106, ADR 0037): a sponsor buys a property and raises the equity
 * from accredited investors. This file is the registry of what the offering documents say —
 * every fee, distribution term and claim the extraction may propose, the documents each comes
 * from, and how a person confirms it. Pactlab organises evidence and flags gaps for the sponsor
 * and counsel: it is not legal advice, makes no accreditation determination and performs no
 * securities-offering or broker-dealer function.
 */

/** Where a term or claim was read. */
export const OFFERING_SOURCES = ['PPM', 'OPERATING_AGREEMENT', 'DECK'] as const;
export type OfferingSource = (typeof OFFERING_SOURCES)[number];
export const OFFERING_SOURCE_LABELS = { PPM: 'PPM', OPERATING_AGREEMENT: 'Operating agreement', DECK: 'Investor deck' } as const satisfies Record<OfferingSource, string>;

/** The intake category that holds each source document. */
export const OFFERING_SOURCE_CATEGORY = { PPM: 'OFFERING_PPM', OPERATING_AGREEMENT: 'OPERATING_AGREEMENT', DECK: 'INVESTOR_DECK' } as const satisfies Record<OfferingSource, string>;

/** Terms: what the investors pay and how cash is split. Percent figures are stored as percent (8 = 8%). */
export const OFFERING_TERM_KINDS = ['ACQUISITION_FEE', 'ASSET_MANAGEMENT_FEE', 'DISPOSITION_FEE', 'OTHER_FEE', 'PREFERRED_RETURN', 'PROMOTE_TIER', 'CATCH_UP'] as const;
/** Claims: what the offering tells investors to expect, and the sponsor's history. */
export const OFFERING_CLAIM_KINDS = ['PROJECTED_IRR', 'EQUITY_MULTIPLE', 'CASH_ON_CASH', 'OCCUPANCY', 'NOI_GROWTH', 'EXIT_CAP_RATE', 'TRACK_RECORD'] as const;
export const OFFERING_ITEM_KINDS = [...OFFERING_TERM_KINDS, ...OFFERING_CLAIM_KINDS] as const;
export type OfferingTermKind = (typeof OFFERING_TERM_KINDS)[number];
export type OfferingClaimKind = (typeof OFFERING_CLAIM_KINDS)[number];
export type OfferingItemKind = (typeof OFFERING_ITEM_KINDS)[number];

export type OfferingUnit = 'PERCENT' | 'MULTIPLE';

export interface OfferingKindDefinition {
  readonly group: 'TERM' | 'CLAIM';
  readonly label: string;
  readonly unit: OfferingUnit;
  /** What the percentage is of (fees); null when the figure stands alone. */
  readonly basis: string | null;
  /** True when the item needs a free label: the fee's name, or the prior deal a track-record claim names. */
  readonly labelled: boolean;
  /** True for promote tiers: the investors' IRR hurdle (absent on the last tier) and the sponsor's share. */
  readonly tier: boolean;
}

export const OFFERING_KIND_REGISTRY = {
  ACQUISITION_FEE: { group: 'TERM', label: 'Acquisition fee', unit: 'PERCENT', basis: 'of the purchase price', labelled: false, tier: false },
  ASSET_MANAGEMENT_FEE: { group: 'TERM', label: 'Asset-management fee', unit: 'PERCENT', basis: 'of the equity raised, per year', labelled: false, tier: false },
  DISPOSITION_FEE: { group: 'TERM', label: 'Disposition fee', unit: 'PERCENT', basis: 'of the sale price', labelled: false, tier: false },
  OTHER_FEE: { group: 'TERM', label: 'Other fee', unit: 'PERCENT', basis: 'as the document states', labelled: true, tier: false },
  PREFERRED_RETURN: { group: 'TERM', label: 'Preferred return', unit: 'PERCENT', basis: 'per year on unreturned capital', labelled: false, tier: false },
  PROMOTE_TIER: { group: 'TERM', label: 'Promote tier (sponsor share)', unit: 'PERCENT', basis: 'of cash in the tier', labelled: false, tier: true },
  CATCH_UP: { group: 'TERM', label: 'Sponsor catch-up', unit: 'PERCENT', basis: 'of cash until caught up', labelled: false, tier: false },
  PROJECTED_IRR: { group: 'CLAIM', label: 'Projected investor IRR', unit: 'PERCENT', basis: null, labelled: false, tier: false },
  EQUITY_MULTIPLE: { group: 'CLAIM', label: 'Projected equity multiple', unit: 'MULTIPLE', basis: null, labelled: false, tier: false },
  CASH_ON_CASH: { group: 'CLAIM', label: 'Projected average cash-on-cash', unit: 'PERCENT', basis: null, labelled: false, tier: false },
  OCCUPANCY: { group: 'CLAIM', label: 'Occupancy', unit: 'PERCENT', basis: null, labelled: false, tier: false },
  NOI_GROWTH: { group: 'CLAIM', label: 'NOI growth assumption', unit: 'PERCENT', basis: 'per year', labelled: false, tier: false },
  EXIT_CAP_RATE: { group: 'CLAIM', label: 'Exit cap rate assumption', unit: 'PERCENT', basis: null, labelled: false, tier: false },
  TRACK_RECORD: { group: 'CLAIM', label: 'Track-record claim (prior deal IRR)', unit: 'PERCENT', basis: null, labelled: true, tier: false },
} as const satisfies Record<OfferingItemKind, OfferingKindDefinition>;

/** AI proposes; a person confirms (or edits, then confirms) or rejects. Only CONFIRMED items feed the math. */
export const OFFERING_ITEM_STATUSES = ['PROPOSED', 'CONFIRMED', 'REJECTED'] as const;
export type OfferingItemStatus = (typeof OFFERING_ITEM_STATUSES)[number];

export const OFFERING_ITEM_ORIGINS = ['AI', 'PERSON'] as const;
export type OfferingItemOrigin = (typeof OFFERING_ITEM_ORIGINS)[number];

/** Regulation D exemption the raise relies on; 506(c) requires investors to be verified as accredited. */
export const OFFERING_EXEMPTIONS = ['RULE_506B', 'RULE_506C'] as const;
export type OfferingExemption = (typeof OFFERING_EXEMPTIONS)[number];
export const OFFERING_EXEMPTION_LABELS = { RULE_506B: 'Rule 506(b)', RULE_506C: 'Rule 506(c)' } as const satisfies Record<OfferingExemption, string>;

/** Scenario labels for the investor return paths: computed from stated assumptions, never a promise. */
export const OFFERING_SCENARIOS = ['DOWNSIDE', 'BASE', 'UPSIDE'] as const;
export type OfferingScenario = (typeof OFFERING_SCENARIOS)[number];

export const SYNDICATION_GUARDRAIL =
  'Diligence support only: not legal advice, no accreditation determination, and no securities-offering or broker-dealer function. Pactlab organises evidence and flags gaps for the sponsor, the investors and their counsel.';
export const SCENARIO_LABEL = 'Scenario computed from stated assumptions — not a projection or promise.';

/** Tolerances for the stated-vs-recomputed checks (points of IRR, cash-on-cash and occupancy; times for the multiple). */
export const OFFERING_TOLERANCES = { irrPoints: '1', multiple: '0.1', cashOnCashPoints: '1', occupancyPoints: '2', trackRecordPoints: '1' } as const;

export function isOfferingTerm(kind: OfferingItemKind): kind is OfferingTermKind {
  return OFFERING_KIND_REGISTRY[kind].group === 'TERM';
}
