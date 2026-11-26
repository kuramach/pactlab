/**
 * Fintech (T-159, ADR 0050): payments and lending economics checked against processor and licence
 * evidence. This file is the registry of the codes the fintech imports use and the words the
 * Payments page carries. Pactlab reports licence status and dates as the documents state them and
 * compliance evidence as present or absent: it never says whether a licence is required or whether a
 * programme is compliant.
 */

/** What a licence-register row is. */
export const FINTECH_LICENCE_KINDS = ['money_transmitter', 'lending', 'payment_institution', 'e_money', 'other_licence', 'sponsor_bank'] as const;
export type FintechLicenceKind = (typeof FINTECH_LICENCE_KINDS)[number];
export const FINTECH_LICENCE_KIND_LABELS = {
  money_transmitter: 'Money-transmitter licence',
  lending: 'Lending licence',
  payment_institution: 'Payment-institution licence',
  e_money: 'E-money licence',
  other_licence: 'Other licence',
  sponsor_bank: 'Sponsor-bank agreement',
} as const satisfies Record<FintechLicenceKind, string>;

/** The register's own status for a row; the documents' dates may say otherwise, and then they govern. */
export const FINTECH_LICENCE_STATUSES = ['active', 'pending', 'lapsed', 'surrendered', 'revoked'] as const;

/** The compliance evidence the pack looks for, and how each is shown when it is missing. */
export const FINTECH_COMPLIANCE_KINDS = ['PCI_ATTESTATION', 'AML_PROGRAM', 'REGULATORY_EXAM'] as const;
export type FintechComplianceKind = (typeof FINTECH_COMPLIANCE_KINDS)[number];
export const FINTECH_COMPLIANCE_LABELS = {
  PCI_ATTESTATION: 'PCI attestation of compliance',
  AML_PROGRAM: 'KYC/AML programme',
  REGULATORY_EXAM: 'Regulatory exam report or consent order',
} as const satisfies Record<FintechComplianceKind, string>;

export const FINTECH_GUARDRAIL =
  'Diligence support, not legal or regulatory advice: licence status and dates are reported as the register and the documents state them, and compliance evidence as present or absent. Pactlab never says whether a licence is required or whether a programme is compliant.';
export const FINTECH_NO_INVENTED_FIGURES =
  'Every figure comes from the processor export, the licence register, the imported P&L or a sentence quoted from a document; what none of them states is shown as missing, never filled in.';
