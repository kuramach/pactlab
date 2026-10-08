/** A Pact is a deal seen as an agreement between two parties. */
export const PARTY_ROLES = ['BUYER', 'SELLER'] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const OWNERSHIPS = ['PUBLIC', 'PRIVATE'] as const;
export type Ownership = (typeof OWNERSHIPS)[number];

/** The seller's line of business decides which sources Pactlab asks for. */
export const COMPANY_TYPES = [
  'SOFTWARE_SAAS',
  'FINTECH',
  'HEALTHCARE',
  'TELECOM_MEDIA',
  'PROFESSIONAL_SERVICES',
  'PHARMA_BIOTECH',
  'ECOMMERCE_DTC',
  'OTHER',
] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export const COMPANY_TYPE_LABELS: Readonly<Record<CompanyType, string>> = {
  SOFTWARE_SAAS: 'Software & SaaS',
  FINTECH: 'Fintech',
  HEALTHCARE: 'Healthcare & health tech',
  TELECOM_MEDIA: 'Telecom & media',
  PROFESSIONAL_SERVICES: 'Professional services',
  PHARMA_BIOTECH: 'Pharma & biotech',
  ECOMMERCE_DTC: 'E-commerce & DTC',
  OTHER: 'Other',
};

export interface PartyProfile {
  readonly name: string;
  readonly ownership: Ownership;
  /** Required for public companies, absent for private ones. */
  readonly ticker?: string | null;
  readonly exchange?: string | null;
  readonly website?: string | null;
  /** Required for the seller; optional for the buyer. */
  readonly companyType?: CompanyType | null;
}
