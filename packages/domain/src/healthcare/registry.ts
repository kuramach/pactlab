/**
 * Healthcare services (T-160, ADR 0051): multi-site provider diligence — payer mix and collections,
 * denials, credentialing, clinician concentration and compliance evidence. This file is the registry
 * of the codes the healthcare imports use and the words the Practice page carries. Pactlab checks
 * documents, dates and arithmetic: it never assesses the quality of care or legal compliance.
 */

/** Who pays a claim, as the remittance export and the payer contract register classify it. */
export const HEALTHCARE_PAYER_CLASSES = ['commercial', 'medicare', 'medicaid', 'other_government', 'self_pay'] as const;
export type HealthcarePayerClass = (typeof HEALTHCARE_PAYER_CLASSES)[number];
export const HEALTHCARE_PAYER_CLASS_LABELS = {
  commercial: 'Commercial',
  medicare: 'Medicare',
  medicaid: 'Medicaid',
  other_government: 'Other government',
  self_pay: 'Self-pay',
} as const satisfies Record<HealthcarePayerClass, string>;

/** What a credentialing-register row is. */
export const HEALTHCARE_CREDENTIAL_KINDS = ['state_licence', 'controlled_substance', 'board_certification', 'payer_enrollment'] as const;
export type HealthcareCredentialKind = (typeof HEALTHCARE_CREDENTIAL_KINDS)[number];
export const HEALTHCARE_CREDENTIAL_KIND_LABELS = {
  state_licence: 'State licence',
  controlled_substance: 'Controlled-substance registration',
  board_certification: 'Board certification',
  payer_enrollment: 'Payer enrolment',
} as const satisfies Record<HealthcareCredentialKind, string>;

/** The register's own status for a row; a verification document's date may say otherwise, and then it governs. */
export const HEALTHCARE_CREDENTIAL_STATUSES = ['active', 'pending', 'expired', 'suspended', 'revoked'] as const;

/** The compliance evidence the pack looks for, and how each is shown when it is missing. */
export const HEALTHCARE_COMPLIANCE_KINDS = ['HIPAA_RISK_ASSESSMENT', 'CODING_AUDIT', 'LICENCE_VERIFICATION', 'RESTRICTIVE_COVENANTS'] as const;
export type HealthcareComplianceKind = (typeof HEALTHCARE_COMPLIANCE_KINDS)[number];
export const HEALTHCARE_COMPLIANCE_LABELS = {
  HIPAA_RISK_ASSESSMENT: 'HIPAA risk assessment',
  CODING_AUDIT: 'Coding or billing audit',
  LICENCE_VERIFICATION: 'Licence verification',
  RESTRICTIVE_COVENANTS: 'Non-compete and retention schedule',
} as const satisfies Record<HealthcareComplianceKind, string>;

export const HEALTHCARE_GUARDRAIL =
  'Diligence support, not clinical or legal advice: the pack checks documents, dates and arithmetic. It never assesses the quality of care, whether billing or a referral arrangement is lawful, or what follows from an expired licence; that is for clinicians and counsel.';
export const HEALTHCARE_NO_INVENTED_FIGURES =
  'Every figure comes from the remittance and collections exports, the registers, the imported P&L or a sentence quoted from a document; what none of them states is shown as missing, never filled in. Clinicians appear only as pseudonymous references and never reach a model.';
