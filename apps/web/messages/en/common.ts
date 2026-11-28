import type { CompanyType, DealPhase } from '@pactlab/domain';

/**
 * Words shared across the app (T-172): states every data surface shows, the pager, the pact's labels, and the
 * reasons the API gives by code. English is the source; translations overlay this shape (`messages/<locale>`).
 */
export const common = {
  states: {
    signedOut: { title: 'Sign in required', description: 'Sign in to see the deals and evidence you are a member of.' },
    forbidden: { title: 'No access', description: 'Your role on this deal does not include evidence access.' },
    notFound: { title: 'Not found', description: 'This item does not exist or you do not have access to it.' },
    error: { title: 'Something went wrong', description: 'The request could not be completed.', reference: 'Reference {id}.' },
  },
  /** One-line results of an action, by outcome code; a page adds its own. */
  outcomes: {
    forbidden: 'Your role on this deal does not allow that.',
    conflict: 'Someone changed this in the meantime. Reload and try again.',
    invalid: 'Some details were not accepted. Check them and try again.',
    unavailable: 'That service is not available right now.',
    'signed-out': 'Your session ended. Log in again.',
    'not-found': 'That item no longer exists.',
    error: 'Something went wrong. Try again.',
  },
  pager: { window: '{start}–{end} of {total}', previous: '← Previous', next: 'Next →' },
  /** The pact's phase (Pre-Diligence, Diligence, Post-Close). */
  phases: { PRE: 'Pre-Diligence', DILIGENCE: 'Diligence', POST: 'Post-Close' } satisfies Record<DealPhase, string>,
  stages: { SCREENING: 'Screening', DILIGENCE: 'Diligence', NEGOTIATION: 'Negotiation', SIGNED: 'Signed', CLOSED: 'Closed' },
  dealTypes: { PUBLIC_ACQUIRER: 'Public acquirer', PRIVATE_ACQUIRER: 'Private acquisition', TAKE_PRIVATE: 'Take-private' },
  companyTypes: {
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
    VENTURE_RAISE: 'Venture Raise',
    MULTIFAMILY_SYNDICATION: 'Multifamily syndication',
    MUSIC_RIGHTS: 'Music rights',
    ENERGY_GENERATION: 'Energy generation & rights',
    STARTUP_SPV: 'Startup equity SPV',
    OTHER: 'Other',
  } satisfies Record<CompanyType, string>,
  /** What the seller said, against what the evidence shows (T-094 B7). */
  claims: {
    verdicts: {
      UNVERIFIED: { label: 'Not checked yet', short: 'Seller claim not checked' },
      VERIFIED: { label: 'Confirmed by the evidence', short: 'Confirms what the seller said' },
      CONTRADICTED: { label: 'Contradicted by the evidence', short: 'Contradicts what the seller said' },
    },
    handSourcedHelp: 'Entered by hand in Pactlab Rinse: the seller’s word, not documentary evidence.',
    restsOnHandSourced: 'Rests on a hand-sourced claim',
    handSourced: 'Hand-sourced',
    none: 'This finding is not linked to anything the seller said.',
    listLabel: 'What the seller said',
    sellerSaid: 'The seller said:',
  },
  /** An artefact built on an import that was later withdrawn (T-154). */
  withdrawn: {
    badge: 'Source withdrawn',
    notice: 'Source withdrawn: {subject} was built on data from an import that has since been withdrawn. It is kept as it was.',
    item: 'withdrawn {date}: “{reason}”',
  },
  evidence: { documentPage: 'document p. {page}', record: 'evidence', open: 'open evidence' },
};
