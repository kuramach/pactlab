/**
 * Hospitals (T-162, ADR 0053): hospital diligence — the filed cost report reconciled against the deck
 * and the financial statements, the payer contract register read from the agreements, the medical-staff
 * register at hospital scale, the plant and capex trend, and quality-reporting claims. This file holds
 * the codes the Hospital page uses and the words it carries. Documents, dates and arithmetic only: never
 * a clinical, survey or legal judgment.
 */

/** The figures the cost-report reconciliation reads, from the cost report and from the deck. */
export const HOSPITALS_COST_REPORT_FIGURES = ['OCCUPANCY', 'MEDICARE_SHARE', 'MEDICAID_SHARE', 'COMMERCIAL_SHARE', 'TOTAL_COSTS'] as const;
export type HospitalsCostReportFigure = (typeof HOSPITALS_COST_REPORT_FIGURES)[number];
export const HOSPITALS_COST_REPORT_FIGURE_LABELS = {
  OCCUPANCY: 'Occupancy of licensed beds',
  MEDICARE_SHARE: 'Medicare share of inpatient days',
  MEDICAID_SHARE: 'Medicaid share of inpatient days',
  COMMERCIAL_SHARE: 'Commercial share of inpatient days',
  TOTAL_COSTS: 'Total operating costs',
} as const satisfies Record<HospitalsCostReportFigure, string>;

/** What the payer contract register reads from each agreement, and how each is shown when no sentence states it. */
export const HOSPITALS_CONTRACT_TERMS = ['RATE_BASIS', 'EXPIRY', 'RENEGOTIATION'] as const;
export type HospitalsContractTerm = (typeof HOSPITALS_CONTRACT_TERMS)[number];
export const HOSPITALS_CONTRACT_TERM_LABELS = {
  RATE_BASIS: 'Rate basis',
  EXPIRY: 'Term ends',
  RENEGOTIATION: 'Renewal or renegotiation window',
} as const satisfies Record<HospitalsContractTerm, string>;

/** The register's privilege statuses that still count as holding privileges; a lapsed date may say otherwise. */
export const HOSPITALS_PRIVILEGE_STATUSES = ['active', 'provisional', 'reappointed', 'lapsed', 'suspended', 'relinquished'] as const;

export const HOSPITALS_GUARDRAIL =
  'Diligence support, not clinical, survey or legal advice: the pack reconciles documents, dates and arithmetic. It never predicts a survey or accreditation outcome, assesses the quality of care, or says what a contract means in law; that is for clinicians, surveyors and counsel.';
export const HOSPITALS_NO_INVENTED_FIGURES =
  'Every figure comes from the census, payer-mix and medical-staff exports, the imported P&L or a sentence quoted from a document; what none of them states is shown as missing, never filled in. Medical staff appear only as pseudonymous references and never reach a model.';
