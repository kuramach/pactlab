import type { ImportTarget } from '../imports/targets';
import { COMPANY_TYPES, COMPANY_TYPE_LABELS, type CompanyType } from '../pacts/types';

/**
 * Industry packs (spec §19, ADR 0008, ADR 0009). A deal's pack is its
 * seller's company type. Everything that differs between packs is an entry
 * here — import targets, the metric calculator, finding rules and valuation
 * methods — so code reads the registry and never branches on the pack.
 * Calculator, method and rule ids resolve in `@pactlab/calculations`; the API
 * assembles the rule registry; a cross-package test checks every id resolves.
 */
export type PackId = Exclude<CompanyType, 'OTHER'>;
export const PACK_IDS = COMPANY_TYPES.filter((type): type is PackId => type !== 'OTHER');

export type PackCluster = 'technology' | 'healthcare' | 'real-estate' | 'services' | 'life-sciences' | 'consumer';

/** Calculator ids in `@pactlab/calculations` (`metricCalculator`). */
export const METRIC_CALCULATOR_IDS = ['saas-metrics', 'multifamily-metrics'] as const;
export type MetricCalculatorId = (typeof METRIC_CALCULATOR_IDS)[number];

/** Valuation method ids in `@pactlab/calculations` (`VALUATION_METHODS`). */
export const PACK_VALUATION_METHODS = ['ARR_MULTIPLE', 'DCF', 'NOI_CAP_RATE'] as const;
export type PackValuationMethod = (typeof PACK_VALUATION_METHODS)[number];

export interface PackDefinition {
  readonly id: PackId;
  /** Marketing-site slug (`apps/site/lib/content.ts`) and demo-data folder name. */
  readonly slug: string;
  readonly label: string;
  readonly cluster: PackCluster;
  /** CSV import targets offered on Sources (ADR 0010); billing first. */
  readonly importTargets: readonly ImportTarget[];
  readonly metricCalculator: MetricCalculatorId;
  /** Deterministic finding rules run over the pack's evidence (implemented in `@pactlab/calculations`). */
  readonly findingRules: readonly string[];
  readonly valuationMethods: readonly PackValuationMethod[];
  /** True once the pack's own task has shipped; until then the core applies as it is. */
  readonly built: boolean;
}

/** What every pack starts with: the software core, which transfers as it is. */
const CORE = {
  importTargets: ['BILLING_INVOICE_LINE'],
  metricCalculator: 'saas-metrics',
  findingRules: [],
  valuationMethods: ['ARR_MULTIPLE', 'DCF'],
} as const satisfies Pick<PackDefinition, 'importTargets' | 'metricCalculator' | 'findingRules' | 'valuationMethods'>;

const pack = (id: PackId, slug: string, cluster: PackCluster, built = false): PackDefinition => ({
  id,
  slug,
  label: COMPANY_TYPE_LABELS[id],
  cluster,
  ...CORE,
  built,
});

export const PACKS: Readonly<Record<PackId, PackDefinition>> = {
  SOFTWARE_SAAS: pack('SOFTWARE_SAAS', 'software-saas', 'technology', true),
  FINTECH: {
    ...pack('FINTECH', 'fintech', 'technology', true),
    importTargets: ['BILLING_INVOICE_LINE', 'FINTECH_LOAN_TAPE', 'FINTECH_AML_ALERT'],
    findingRules: ['fintech-credit-loss', 'fintech-aml-unreviewed', 'fintech-partner-bank-coc'],
  },
  HEALTHCARE: pack('HEALTHCARE', 'healthcare', 'healthcare'),
  TELECOM_MEDIA: pack('TELECOM_MEDIA', 'telecom-media', 'technology'),
  PROFESSIONAL_SERVICES: pack('PROFESSIONAL_SERVICES', 'professional-services', 'services'),
  PHARMA_BIOTECH: pack('PHARMA_BIOTECH', 'pharma-biotech', 'life-sciences'),
  ECOMMERCE_DTC: pack('ECOMMERCE_DTC', 'ecommerce-dtc', 'consumer'),
  MULTIFAMILY: {
    ...pack('MULTIFAMILY', 'multifamily', 'real-estate', true),
    importTargets: ['BILLING_INVOICE_LINE', 'MULTIFAMILY_RENT_ROLL', 'MULTIFAMILY_T12', 'MULTIFAMILY_DELINQUENCY', 'MULTIFAMILY_INSPECTION'],
    metricCalculator: 'multifamily-metrics',
    findingRules: ['multifamily-om-noi', 'multifamily-deferred-maintenance', 'multifamily-delinquency-concentration', 'multifamily-loss-to-lease'],
    valuationMethods: ['NOI_CAP_RATE', 'DCF'],
  },
  COMMERCIAL_PROPERTY: pack('COMMERCIAL_PROPERTY', 'commercial-property', 'real-estate'),
  HOTELS: pack('HOTELS', 'hotels', 'real-estate'),
  SMALL_CLINICS: pack('SMALL_CLINICS', 'small-clinics', 'healthcare'),
  HOSPITALS: pack('HOSPITALS', 'hospitals', 'healthcare'),
};

/** The pack for a seller's company type; `OTHER` (or none) reads the software core as it is. */
export function packFor(companyType: CompanyType | null | undefined): PackDefinition {
  return companyType && companyType !== 'OTHER' ? PACKS[companyType] : PACKS.SOFTWARE_SAAS;
}
