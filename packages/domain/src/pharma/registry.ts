/**
 * Pharma and biotech (T-163, ADR 0053): pipeline claims, the patent estate and licence obligations,
 * checked against documents. This file is the registry of the codes the pharma imports use and the
 * words the Pipeline page carries. Pactlab checks documents, dates and consistency: it never opines on
 * efficacy, approvability or trial design.
 */

/** What a line of the seller's payment obligations model is. */
export const PHARMA_OBLIGATION_KINDS = ['milestone', 'royalty', 'licence_fee'] as const;
export type PharmaObligationKind = (typeof PHARMA_OBLIGATION_KINDS)[number];
export const PHARMA_OBLIGATION_KIND_LABELS = {
  milestone: 'Milestone payment',
  royalty: 'Royalty',
  licence_fee: 'Licence fee',
} as const satisfies Record<PharmaObligationKind, string>;

/** A trial-registry status, as the registry records it; the last three mean the trial is not running. */
export const PHARMA_TRIAL_STATUSES = ['not yet recruiting', 'recruiting', 'active not recruiting', 'completed', 'suspended', 'terminated', 'withdrawn'] as const;

/** What a pipeline claim is about. */
export const PHARMA_CLAIM_ASPECTS = ['PHASE', 'TIMELINE', 'STATUS'] as const;
export type PharmaClaimAspect = (typeof PHARMA_CLAIM_ASPECTS)[number];
export const PHARMA_CLAIM_ASPECT_LABELS = {
  PHASE: 'Phase',
  TIMELINE: 'Timeline',
  STATUS: 'Status',
} as const satisfies Record<PharmaClaimAspect, string>;

/** How each agreement obligation stands against the seller's model. */
export const PHARMA_OBLIGATION_STATES = ['IN_MODEL', 'OMITTED', 'UNDERSTATED', 'RATE_UNDERSTATED'] as const;
export type PharmaObligationState = (typeof PHARMA_OBLIGATION_STATES)[number];
export const PHARMA_OBLIGATION_STATE_LABELS = {
  IN_MODEL: 'In the model',
  OMITTED: 'Missing from the model',
  UNDERSTATED: 'Understated in the model',
  RATE_UNDERSTATED: 'Rate understated in the model',
} as const satisfies Record<PharmaObligationState, string>;

export const PHARMA_GUARDRAIL =
  'Diligence support, not scientific, regulatory or legal advice: Pactlab checks documents, dates and consistency — a claimed phase against the registry filings, patent expiries against the hold, payments against the agreements. It never opines on efficacy, approvability or trial design.';
export const PHARMA_NO_INVENTED_FIGURES =
  'Every figure comes from an import (the pipeline, the registry records, the patent schedule, the obligations model, the R&D roster, the P&L) or a sentence quoted from a document; what none of them states is shown as missing, never filled in.';
