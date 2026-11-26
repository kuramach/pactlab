/**
 * Small clinics (T-161, ADR 0052): the few-site clinic variant of the healthcare pack. The T-160
 * evidence set (remittances, collections by clinician, credentialing, payer contracts) is reused as it
 * is; this pack adds the risks that concentrate in a small clinic — one owner-operator, one referral
 * source, one lease. This file holds the words the Clinic page carries. Documents, dates and arithmetic
 * only: never clinical or legal judgment.
 */

/** What the premises check reads from the lease, and how each is shown when no sentence states it. */
export const CLINICS_LEASE_TERMS = ['EXPIRY', 'RENEWAL', 'ASSIGNMENT'] as const;
export type ClinicsLeaseTerm = (typeof CLINICS_LEASE_TERMS)[number];
export const CLINICS_LEASE_TERM_LABELS = {
  EXPIRY: 'Term ends',
  RENEWAL: 'Renewal option',
  ASSIGNMENT: 'Assignment on sale',
} as const satisfies Record<ClinicsLeaseTerm, string>;

export const CLINICS_GUARDRAIL =
  'Diligence support, not clinical or legal advice: the pack checks documents, dates and arithmetic. It never assesses the quality of care, whether a referral arrangement is lawful, or what a lease means in law; that is for clinicians and counsel.';
export const CLINICS_NO_INVENTED_FIGURES =
  'Every figure comes from the schedule, billing and referral exports, the imported P&L or a sentence quoted from a document; what none of them states is shown as missing, never filled in. Providers, including the selling owner, appear only as pseudonymous references and never reach a model.';
