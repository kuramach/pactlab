import { COMPANY_TYPE_LABELS, type CompanyType } from './types';

/** The kinds of system a seller runs on that Pactlab can read. */
export const SOURCE_KINDS = ['BILLING', 'CODE', 'DELIVERY', 'DOCUMENTS'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** How a source gets its data in. Every source offers a live API and an upload. */
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
  readonly upload: { readonly format: 'CSV' | 'FILES'; readonly label: string };
  readonly availability: Readonly<Record<ConnectMethod, MethodAvailability>>;
}

/**
 * Rollout state lives here as data. CSV import (T-026) and live API
 * connectors (T-027+) flip these to AVAILABLE as they ship.
 */
const DEFINITIONS: Readonly<Record<SourceKind, SourceDefinition>> = {
  BILLING: {
    kind: 'BILLING',
    label: 'Billing',
    provider: 'stripe',
    providerLabel: 'Stripe',
    matchesProviders: ['stripe', 'csv'],
    why: 'Rebuilds MRR, ARR and retention from invoices so management ARR can be reconciled to transactions.',
    produces: 'Invoice lines, customers, subscriptions',
    upload: { format: 'CSV', label: 'Upload billing CSV' },
    availability: { API: 'NEXT', UPLOAD: 'NEXT' },
  },
  CODE: {
    kind: 'CODE',
    label: 'Code',
    provider: 'github',
    providerLabel: 'GitHub',
    matchesProviders: ['github'],
    why: 'Shows who builds and maintains the product, how healthy the codebase is and which licenses it carries.',
    produces: 'Repositories, commits, contributors (no source code is kept)',
    upload: { format: 'CSV', label: 'Upload commits CSV' },
    availability: { API: 'NEXT', UPLOAD: 'NEXT' },
  },
  DELIVERY: {
    kind: 'DELIVERY',
    label: 'Delivery',
    provider: 'jira',
    providerLabel: 'Jira',
    matchesProviders: ['jira'],
    why: 'Tests whether the roadmap is real: throughput, estimates and how work is spread across the team.',
    produces: 'Issues, sprints, delivery history',
    upload: { format: 'CSV', label: 'Upload issues CSV' },
    availability: { API: 'NEXT', UPLOAD: 'NEXT' },
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
    availability: { API: 'NEXT', UPLOAD: 'NEXT' },
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
const SOURCES_BY_TYPE: Readonly<Record<CompanyType, readonly SourceKind[]>> = {
  SOFTWARE_SAAS: ALL,
  FINTECH: ALL,
  HEALTHCARE: ALL,
  TELECOM_MEDIA: ALL,
  ECOMMERCE_DTC: ALL,
  PROFESSIONAL_SERVICES: ['BILLING', 'DELIVERY', 'DOCUMENTS'],
  PHARMA_BIOTECH: ['DOCUMENTS'],
  OTHER: ['BILLING', 'DOCUMENTS'],
};

/** Which sources to switch on for a seller of this type. Pure data; never branches on mode. */
export function sourcesFor(companyType: CompanyType): SourcePlan {
  const packAvailable = companyType === 'SOFTWARE_SAAS';
  const label = COMPANY_TYPE_LABELS[companyType];
  return {
    companyType,
    packAvailable,
    note: packAvailable
      ? null
      : companyType === 'OTHER'
        ? 'No industry pack applies. Billing and documents are read as they are.'
        : `The ${label} industry pack is planned. Until it ships, these core sources are read as they are, without sector-specific checks.`,
    sources: SOURCES_BY_TYPE[companyType].map((kind) => DEFINITIONS[kind]),
  };
}

/** The source a connection belongs to, if any. */
export function sourceKindForProvider(provider: string): SourceKind | null {
  return ALL.find((kind) => DEFINITIONS[kind].matchesProviders.includes(provider)) ?? null;
}
