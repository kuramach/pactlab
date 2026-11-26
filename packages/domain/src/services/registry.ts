/**
 * IT and professional services (T-167, ADR 0055): utilization, realization and the people the fees depend
 * on. This file is the registry of the codes the services imports use and the words the Practice page
 * carries. Pactlab reports documents, coverage and arithmetic: it never assesses an individual, and it
 * never says whether a covenant is enforceable.
 */

/** What kind of engagement a time-and-billing row was billed under. Retainers and managed services recur. */
export const SERVICES_ENGAGEMENT_KINDS = ['retainer', 'managed_service', 'project', 'time_and_materials'] as const;
export type ServicesEngagementKind = (typeof SERVICES_ENGAGEMENT_KINDS)[number];
export const SERVICES_ENGAGEMENT_KIND_LABELS = {
  retainer: 'Retainer',
  managed_service: 'Managed service',
  project: 'Fixed-scope project',
  time_and_materials: 'Time and materials',
} as const satisfies Record<ServicesEngagementKind, string>;
/** The engagement kinds read as recurring revenue. */
export const SERVICES_RECURRING_ENGAGEMENTS: readonly ServicesEngagementKind[] = ['retainer', 'managed_service'];

/** The two ledgers an ageing report covers. */
export const SERVICES_LEDGERS = ['wip', 'ar'] as const;
export type ServicesLedger = (typeof SERVICES_LEDGERS)[number];
export const SERVICES_LEDGER_LABELS = {
  wip: 'Work in progress (unbilled)',
  ar: 'Debtors (billed, unpaid)',
} as const satisfies Record<ServicesLedger, string>;

/** Ageing bands, in days; the last two are "over 90 days". */
export const SERVICES_AGEING_BANDS = ['0-30', '31-60', '61-90', '91-180', '181+'] as const;
export type ServicesAgeingBand = (typeof SERVICES_AGEING_BANDS)[number];
export const SERVICES_AGEING_BAND_LABELS = {
  '0-30': '0–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '91-180': '91–180 days',
  '181+': 'Over 180 days',
} as const satisfies Record<ServicesAgeingBand, string>;
export const SERVICES_OVER_90_BANDS: readonly ServicesAgeingBand[] = ['91-180', '181+'];

/** What the documents say about a revenue-carrying person's non-compete or non-solicitation cover. */
export const SERVICES_COVERAGE_STATES = ['COVERED', 'STATED_NONE', 'NOT_IN_EVIDENCE'] as const;
export type ServicesCoverageState = (typeof SERVICES_COVERAGE_STATES)[number];
export const SERVICES_COVERAGE_STATE_LABELS = {
  COVERED: 'Covenant on file',
  STATED_NONE: 'The documents state there is none',
  NOT_IN_EVIDENCE: 'Nothing in the documents',
} as const satisfies Record<ServicesCoverageState, string>;

/** The concentration ceilings a deck may state, checked against the time-and-billing export. */
export const SERVICES_CLAIM_KEYS = ['CLIENT_CEILING', 'PARTNER_CEILING'] as const;
export type ServicesClaimKey = (typeof SERVICES_CLAIM_KEYS)[number];
export const SERVICES_CLAIM_LABELS = {
  CLIENT_CEILING: 'Client concentration ceiling',
  PARTNER_CEILING: 'Partner concentration ceiling',
} as const satisfies Record<ServicesClaimKey, string>;

export const SERVICES_GUARDRAIL =
  'Diligence support, not an HR or legal judgment: Pactlab reports the documents, the covenant coverage they show and the arithmetic of the exports. It never assesses an individual, ranks people or says whether a covenant is enforceable; fee-earners appear only by pseudonymous reference.';
export const SERVICES_NO_INVENTED_FIGURES =
  'Every figure comes from an import (time and billing, timesheets, headcount movements, the ageing reports, the P&L) or a sentence quoted from a document; what none of them states is shown as missing, never filled in.';
