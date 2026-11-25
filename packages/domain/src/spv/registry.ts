/**
 * Startup equity SPV (T-141, ADR 0043): an organizer pools investors into one vehicle that takes
 * one line on a startup's cap table for one round. This file is the registry of what the pack
 * tracks per investor and what the organizer may publish to investors. Pactlab organises evidence
 * and flags gaps for the parties and their counsel: it is not legal advice, performs no
 * securities-offering, broker-dealer or investment-adviser function, and makes no accreditation
 * determination.
 */

/** The vehicle's exempt offering. Under 506(c) every investor must be verified accredited by a third party. */
export const SPV_EXEMPTIONS = ['RULE_506B', 'RULE_506C'] as const;
export type SpvExemption = (typeof SPV_EXEMPTIONS)[number];
export const SPV_EXEMPTION_LABELS = {
  RULE_506B: 'Rule 506(b) — no general solicitation; investors may self-certify',
  RULE_506C: 'Rule 506(c) — general solicitation allowed; accredited status verified by reasonable steps',
} as const satisfies Record<SpvExemption, string>;

/**
 * An investor's accreditation status, tracked and never determined: Pactlab verifies nothing.
 * THIRD_PARTY_VERIFIED records that an outside specialist did (with a link and an evidence pointer).
 */
export const ACCREDITATION_STATUSES = ['NOT_STARTED', 'SELF_CERTIFIED', 'PENDING_VERIFICATION', 'THIRD_PARTY_VERIFIED', 'NOT_ACCREDITED'] as const;
export type AccreditationStatus = (typeof ACCREDITATION_STATUSES)[number];
export const ACCREDITATION_STATUS_LABELS = {
  NOT_STARTED: 'Not started',
  SELF_CERTIFIED: 'Self-certified',
  PENDING_VERIFICATION: 'Verification pending',
  THIRD_PARTY_VERIFIED: 'Verified by a third party',
  NOT_ACCREDITED: 'Not accredited',
} as const satisfies Record<AccreditationStatus, string>;
/** What each exemption accepts as enough (the checks read this; counsel decides). */
export const ACCREDITATION_SUFFICIENT = {
  RULE_506B: ['SELF_CERTIFIED', 'THIRD_PARTY_VERIFIED'],
  RULE_506C: ['THIRD_PARTY_VERIFIED'],
} as const satisfies Record<SpvExemption, readonly AccreditationStatus[]>;

export const INVESTOR_SEAT_STATUSES = ['ACTIVE', 'WITHDRAWN'] as const;
export type InvestorSeatStatus = (typeof INVESTOR_SEAT_STATUSES)[number];

/**
 * The investor view's allow-list (T-141): the only sections a published snapshot may hold. The
 * database refuses any other top-level key (`investor_view_versions_sections` CHECK), so organizer
 * negotiation, side letters, other investors and draft findings cannot enter it by mistake.
 */
export const INVESTOR_VIEW_SECTIONS = ['meta', 'claims', 'capTable', 'economics', 'scenarios'] as const;
export type InvestorViewSection = (typeof INVESTOR_VIEW_SECTIONS)[number];
export const INVESTOR_VIEW_SECTION_LABELS = {
  meta: 'The vehicle and the round',
  claims: 'Round claims register',
  capTable: 'Cap-table and round-math verification',
  economics: 'Vehicle economics check',
  scenarios: 'Net-of-fees return scenarios',
} as const satisfies Record<InvestorViewSection, string>;

export const SPV_GUARDRAIL =
  'Diligence support only: not legal advice. Pactlab performs no securities-offering, broker-dealer or investment-adviser function and makes no accreditation determination — it organises the evidence and flags gaps for the parties and their counsel.';
export const SPV_SCENARIO_LABEL = 'Scenario computed from stated assumptions — not a projection or promise.';
export const SPV_NO_INVENTED_FIGURES = 'Startup metrics and vehicle terms come only from documents and imports. What no document states is shown as absent, never estimated.';
