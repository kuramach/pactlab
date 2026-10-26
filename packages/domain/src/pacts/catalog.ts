import { PACKS } from '../packs/registry';
import { COMPANY_TYPE_LABELS, type CompanyType } from './types';

/** The kinds of system a seller runs on that Pactlab can read. */
export const SOURCE_KINDS = ['BILLING', 'CODE', 'DELIVERY', 'DOCUMENTS', 'INDUSTRY'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * How a source gets its data in. Every source has a live API adapter; billing
 * and industry-pack extracts take CSV exports (ADR 0004, ADR 0010) and
 * documents take files. Source control and delivery tools connect through
 * adapters only — their history can't be trusted from a spreadsheet.
 */
export const CONNECT_METHODS = ['API', 'UPLOAD'] as const;
export type ConnectMethod = (typeof CONNECT_METHODS)[number];

/** `NEXT` means the method is designed and on the build list, not usable yet. */
export type MethodAvailability = 'AVAILABLE' | 'NEXT';

export interface SourceDefinition {
  readonly kind: SourceKind;
  readonly label: string;
  /** Provider the live API connects to, and the provider ids that count as this source. */
  readonly provider: string;
  readonly providerLabel: string;
  readonly matchesProviders: readonly string[];
  readonly why: string;
  readonly produces: string;
  /** Null for adapter-only sources. */
  readonly upload: { readonly format: 'CSV' | 'FILES'; readonly label: string } | null;
  /** Only the methods this source offers. */
  readonly availability: Readonly<Partial<Record<ConnectMethod, MethodAvailability>>>;
}

/** Rollout state lives here as data; each live API connector flips its API to AVAILABLE as it ships. */
const DEFINITIONS: Readonly<Record<SourceKind, SourceDefinition>> = {
  BILLING: {
    kind: 'BILLING',
    label: 'Billing',
    provider: 'stripe',
    providerLabel: 'Stripe',
    matchesProviders: ['stripe', 'csv', 'billing_upload'],
    why: 'Rebuilds MRR, ARR and retention from invoices so management ARR can be reconciled to transactions.',
    produces: 'Invoice lines, customers, subscriptions',
    upload: { format: 'CSV', label: 'Upload billing export' },
    availability: { API: 'NEXT', UPLOAD: 'AVAILABLE' },
  },
  CODE: {
    kind: 'CODE',
    label: 'Code',
    provider: 'github',
    providerLabel: 'GitHub',
    matchesProviders: ['github'],
    why: 'Shows who builds and maintains the product, how healthy the codebase is and which licenses it carries.',
    produces: 'Repositories, commits, contributors (no source code is kept)',
    upload: null,
    availability: { API: 'AVAILABLE' },
  },
  DELIVERY: {
    kind: 'DELIVERY',
    label: 'Delivery',
    provider: 'jira',
    providerLabel: 'Jira',
    matchesProviders: ['jira'],
    why: 'Tests whether the roadmap is real: throughput, estimates and how work is spread across the team.',
    produces: 'Issues, sprints, delivery history',
    upload: null,
    availability: { API: 'NEXT' },
  },
  DOCUMENTS: {
    kind: 'DOCUMENTS',
    label: 'Documents',
    provider: 'data_room',
    providerLabel: 'Data room',
    matchesProviders: ['data_room', 'vdr'],
    why: 'Contracts and filings, read with exact citations, so obligations and change-of-control terms surface early.',
    produces: 'Contracts, filings, policies — cited page by page',
    upload: { format: 'FILES', label: 'Upload documents' },
    // Document upload works (Documents tab); a live data-room connection is next.
    availability: { API: 'NEXT', UPLOAD: 'AVAILABLE' },
  },
  INDUSTRY: {
    kind: 'INDUSTRY',
    label: 'Industry data',
    provider: 'pack_upload',
    providerLabel: 'Industry extracts',
    // Pack extract uploads (ADR 0010) make one `pack_upload` connection per target.
    matchesProviders: ['pack_upload'],
    why: 'The sector extracts the industry pack checks and measures — loan tapes, rent rolls, operating statements and more.',
    produces: 'Pack evidence such as loans, units and monthly operating figures',
    upload: { format: 'CSV', label: 'Upload industry extracts' },
    // File imports first; direct connections to industry systems come later behind the same targets.
    availability: { API: 'NEXT', UPLOAD: 'AVAILABLE' },
  },
};

export interface SourcePlan {
  readonly companyType: CompanyType;
  /** True only where an industry pack is built; otherwise the core sources apply as they are. */
  readonly packAvailable: boolean;
  readonly note: string | null;
  readonly sources: readonly SourceDefinition[];
}

const ALL: readonly SourceKind[] = ['BILLING', 'CODE', 'DELIVERY', 'DOCUMENTS'];
const MATCHABLE: readonly SourceKind[] = [...ALL, 'INDUSTRY'];
const SOURCES_BY_TYPE: Readonly<Record<CompanyType, readonly SourceKind[]>> = {
  SOFTWARE_SAAS: ALL,
  FINTECH: ALL,
  HEALTHCARE: ALL,
  TELECOM_MEDIA: ALL,
  ECOMMERCE_DTC: ALL,
  MULTIFAMILY: ['BILLING', 'DOCUMENTS'],
  COMMERCIAL_PROPERTY: ['BILLING', 'DOCUMENTS'],
  HOTELS: ['BILLING', 'DOCUMENTS'],
  SMALL_CLINICS: ['BILLING', 'DOCUMENTS'],
  HOSPITALS: ['BILLING', 'DOCUMENTS'],
  PROFESSIONAL_SERVICES: ['BILLING', 'DELIVERY', 'DOCUMENTS'],
  PHARMA_BIOTECH: ['DOCUMENTS'],
  VENTURE_RAISE: ALL,
  OTHER: ['BILLING', 'DOCUMENTS'],
};

const hasIndustryExtracts = (companyType: CompanyType) =>
  companyType !== 'OTHER' && PACKS[companyType].importTargets.some((target) => target !== 'BILLING_INVOICE_LINE');

/** Which sources to switch on for a seller of this type. Pure data; never branches on mode. */
export function sourcesFor(companyType: CompanyType): SourcePlan {
  const packAvailable = companyType !== 'OTHER' && PACKS[companyType].built;
  const label = COMPANY_TYPE_LABELS[companyType];
  return {
    companyType,
    packAvailable,
    note: packAvailable
      ? null
      : companyType === 'OTHER'
        ? 'No industry pack applies. Billing and documents are read as they are.'
        : `The ${label} industry pack is planned. Until it ships, these core sources are read as they are, without sector-specific checks.`,
    // A built pack that imports sector extracts adds them as their own source to collect.
    sources: [...SOURCES_BY_TYPE[companyType], ...(packAvailable && hasIndustryExtracts(companyType) ? (['INDUSTRY'] as const) : [])].map((kind) => DEFINITIONS[kind]),
  };
}

/** The source a connection belongs to, if any. */
export function sourceKindForProvider(provider: string): SourceKind | null {
  return MATCHABLE.find((kind) => DEFINITIONS[kind].matchesProviders.includes(provider)) ?? null;
}
