/** A Pact is a deal seen as an agreement between two parties. */
export const PARTY_ROLES = ['BUYER', 'SELLER'] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const OWNERSHIPS = ['PUBLIC', 'PRIVATE'] as const;
export type Ownership = (typeof OWNERSHIPS)[number];

/** The seller's line of business decides which sources Pactlab asks for — and the deal's industry pack (ADR 0009). */
export const COMPANY_TYPES = [
  'SOFTWARE_SAAS',
  'FINTECH',
  'HEALTHCARE',
  'TELECOM_MEDIA',
  'PROFESSIONAL_SERVICES',
  'PHARMA_BIOTECH',
  'ECOMMERCE_DTC',
  'MULTIFAMILY',
  'COMMERCIAL_PROPERTY',
  'HOTELS',
  'SMALL_CLINICS',
  'HOSPITALS',
  'VENTURE_RAISE',
  'MULTIFAMILY_SYNDICATION',
  'MUSIC_RIGHTS',
  'ENERGY_GENERATION',
  'STARTUP_SPV',
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
  MULTIFAMILY: 'Multifamily',
  COMMERCIAL_PROPERTY: 'Commercial property',
  HOTELS: 'Hotels & hospitality',
  SMALL_CLINICS: 'Small clinics',
  HOSPITALS: 'Hospitals',
  // Founder-side: the seller is the founder's own startup, raising capital (T-083).
  VENTURE_RAISE: 'Venture Raise',
  // Sponsor-side: the sponsor buys a property and raises the equity from accredited investors (T-106).
  MULTIFAMILY_SYNDICATION: 'Multifamily syndication',
  // A catalog of music publishing and master recording rights, bought for its royalty income (T-140).
  MUSIC_RIGHTS: 'Music rights',
  // Power plants, oil & gas mineral, royalty and working interests, and energy businesses (T-142).
  ENERGY_GENERATION: 'Energy generation & rights',
  // An organizer pools investors into one vehicle that takes one line in a startup's round (T-141).
  STARTUP_SPV: 'Startup equity SPV',
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
