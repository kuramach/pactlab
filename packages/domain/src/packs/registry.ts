import type { ImportTarget } from '../imports/targets';
import type { PackDocumentCategory } from '../intake/categories';
import type { ExpectedInput } from '../intake/checklist';
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

export type PackCluster = 'technology' | 'healthcare' | 'real-estate' | 'services' | 'life-sciences' | 'consumer' | 'capital' | 'media-rights' | 'energy';

/** Calculator ids in `@pactlab/calculations` (`metricCalculator`). */
export const METRIC_CALCULATOR_IDS = ['saas-metrics', 'multifamily-metrics', 'music-royalties', 'energy-assets'] as const;
export type MetricCalculatorId = (typeof METRIC_CALCULATOR_IDS)[number];

/** Valuation method ids in `@pactlab/calculations` (`VALUATION_METHODS`). */
export const PACK_VALUATION_METHODS = ['ARR_MULTIPLE', 'DCF', 'NOI_CAP_RATE', 'PAYER_MIX_EBITDA', 'ROUND_PRE_MONEY'] as const;
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
  /** What intake expects to receive (T-098); absent → derived by `expectedInputs`. */
  readonly expectedInputs?: readonly ExpectedInput[];
  /** Document categories only this pack offers at intake (e.g. a syndication's PPM), on top of the common ones. */
  readonly documentCategories?: readonly PackDocumentCategory[];
  /**
   * How this pack names a core valuation method (e.g. music rights values on trailing royalty
   * income × a multiple, which the engine runs as the revenue multiple). Labels only: the method,
   * its formula and its validation are the core's.
   */
  readonly methodLabels?: Readonly<Partial<Record<PackValuationMethod, { readonly label: string; readonly help: string; readonly input: string }>>>;
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

const MULTIFAMILY: PackDefinition = {
  ...pack('MULTIFAMILY', 'multifamily', 'real-estate', true),
  importTargets: ['BILLING_INVOICE_LINE', 'MULTIFAMILY_RENT_ROLL', 'MULTIFAMILY_T12', 'MULTIFAMILY_DELINQUENCY', 'MULTIFAMILY_INSPECTION'],
  metricCalculator: 'multifamily-metrics',
  findingRules: ['multifamily-om-noi', 'multifamily-deferred-maintenance', 'multifamily-delinquency-concentration', 'multifamily-loss-to-lease'],
  valuationMethods: ['NOI_CAP_RATE', 'DCF'],
};

export const PACKS: Readonly<Record<PackId, PackDefinition>> = {
  SOFTWARE_SAAS: {
    ...pack('SOFTWARE_SAAS', 'software-saas', 'technology', true),
    findingRules: ['saas-reported-arr', 'saas-revenue-concentration', 'saas-customer-change-of-control', 'saas-hidden-contraction'],
  },
  FINTECH: {
    ...pack('FINTECH', 'fintech', 'technology', true),
    importTargets: ['BILLING_INVOICE_LINE', 'FINTECH_LOAN_TAPE', 'FINTECH_AML_ALERT'],
    findingRules: ['fintech-credit-loss', 'fintech-aml-unreviewed', 'fintech-partner-bank-coc'],
  },
  HEALTHCARE: {
    ...pack('HEALTHCARE', 'healthcare', 'healthcare', true),
    importTargets: ['BILLING_INVOICE_LINE', 'HEALTHCARE_CLAIMS_SUMMARY', 'HEALTHCARE_PROVIDER_ROSTER'],
    findingRules: ['healthcare-government-concentration', 'healthcare-director-fee', 'healthcare-privacy-assessment', 'healthcare-credentials-expiring'],
    // Healthtech targets also run the software path (ARR multiple); services value on DCF.
    valuationMethods: ['DCF', 'ARR_MULTIPLE'],
  },
  TELECOM_MEDIA: {
    ...pack('TELECOM_MEDIA', 'telecom-media', 'technology', true),
    importTargets: ['BILLING_INVOICE_LINE', 'TELECOM_SUBSCRIBERS'],
    findingRules: ['telecom-reported-subscribers', 'telecom-churn-turning', 'telecom-regional-concentration', 'telecom-wholesale-review'],
    // Subscriber revenue runs the SaaS metrics as they are (ARPU ≈ MRR per account, churn ≈ logo churn).
  },
  PROFESSIONAL_SERVICES: {
    ...pack('PROFESSIONAL_SERVICES', 'professional-services', 'services', true),
    importTargets: ['BILLING_INVOICE_LINE', 'SERVICES_TIMESHEETS', 'SERVICES_HEADCOUNT'],
    findingRules: ['services-utilization-gap', 'services-client-termination', 'services-delivery-attrition'],
    // People-driven earnings value on DCF; retainer revenue also reads as recurring.
    valuationMethods: ['DCF', 'ARR_MULTIPLE'],
  },
  PHARMA_BIOTECH: {
    ...pack('PHARMA_BIOTECH', 'pharma-biotech', 'life-sciences', true),
    importTargets: ['BILLING_INVOICE_LINE', 'PHARMA_PATENTS', 'PHARMA_PIPELINE'],
    findingRules: ['pharma-patent-before-forecast', 'pharma-supplier-observations', 'pharma-partner-concentration'],
    // Royalty and product revenue value on DCF, with exclusivity and approval timing as scenario inputs.
    valuationMethods: ['DCF'],
  },
  ECOMMERCE_DTC: {
    ...pack('ECOMMERCE_DTC', 'ecommerce-dtc', 'consumer', true),
    importTargets: ['BILLING_INVOICE_LINE', 'ECOMMERCE_COHORTS', 'ECOMMERCE_AD_SPEND'],
    findingRules: ['ecommerce-marketplace-majority', 'ecommerce-cohort-repeat-decline', 'ecommerce-channel-cac-rising'],
    // Valuation methods unchanged; unit economics arrive as scenario inputs and channel risk as findings.
    valuationMethods: ['DCF', 'ARR_MULTIPLE'],
  },
  MULTIFAMILY,
  COMMERCIAL_PROPERTY: {
    ...pack('COMMERCIAL_PROPERTY', 'commercial-property', 'real-estate', true),
    importTargets: ['BILLING_INVOICE_LINE', 'CRE_RENT_ROLL', 'CRE_CAM_RECONCILIATION'],
    findingRules: ['cre-anchor-rollover', 'cre-environmental-condition', 'cre-cam-under-recovery', 'cre-below-market-anchor'],
    // Income property values on NOI ÷ cap rate (T-059), with a DCF of the rollover schedule alongside.
    valuationMethods: ['NOI_CAP_RATE', 'DCF'],
  },
  HOTELS: {
    ...pack('HOTELS', 'hotels', 'real-estate', true),
    importTargets: ['BILLING_INVOICE_LINE', 'HOTELS_OPERATING_HISTORY', 'HOTELS_STR_BENCHMARK'],
    findingRules: ['hotels-brand-pip', 'hotels-revpar-gap', 'hotels-channel-concentration', 'hotels-seasonal-demand', 'hotels-management-termination-fee'],
    // Hotels value on NOI ÷ cap rate (T-059) with a DCF of RevPAR and GOP-margin trends.
    valuationMethods: ['NOI_CAP_RATE', 'DCF'],
  },
  SMALL_CLINICS: {
    ...pack('SMALL_CLINICS', 'small-clinics', 'healthcare', true),
    importTargets: ['BILLING_INVOICE_LINE', 'CLINICS_PATIENT_VOLUME', 'CLINICS_EQUIPMENT', 'CLINICS_CODING_SUMMARY'],
    // Extends healthcare (T-061): its reimbursement and compliance rules run here too.
    findingRules: ['clinics-provider-carries-site', 'clinics-coding-above-policy', 'clinics-equipment-past-life', 'healthcare-government-concentration', 'healthcare-director-fee', 'healthcare-privacy-assessment'],
    valuationMethods: ['DCF'],
  },
  HOSPITALS: {
    ...pack('HOSPITALS', 'hospitals', 'healthcare', true),
    importTargets: ['BILLING_INVOICE_LINE', 'HOSPITALS_CENSUS', 'HOSPITALS_PAYER_MIX'],
    // Extends healthcare (T-061): its compliance rules run too; payer concentration reads the payer mix instead of billing.
    findingRules: ['hospitals-payer-concentration', 'hospitals-accreditation-transfer', 'hospitals-physician-dependence', 'hospitals-regulatory-capex', 'healthcare-director-fee', 'healthcare-privacy-assessment'],
    valuationMethods: ['PAYER_MIX_EBITDA', 'DCF'],
  },
  // Founder-side (T-083): the founder's own startup is the seller; investors are the counterparty.
  VENTURE_RAISE: {
    ...pack('VENTURE_RAISE', 'venture-raise', 'capital', true),
    importTargets: ['BILLING_INVOICE_LINE', 'VENTURE_CAP_TABLE', 'VENTURE_FINANCIALS'],
    findingRules: [
      'venture-deck-metric',
      'venture-ip-assignment',
      'venture-cap-table-record',
      'venture-safe-stack',
      'venture-runway-short',
      'venture-missing-83b',
      'venture-undisclosed-concentration',
      'venture-term-variance',
    ],
    // The round is the price: the founder's ask, adjusted by what the evidence forces.
    valuationMethods: ['ROUND_PRE_MONEY', 'ARR_MULTIPLE'],
  },
  // Sponsor-side (T-106): the Multifamily pack by reference — its targets, calculator, rules and
  // methods flow through unchanged — plus the offering: the sponsor's track record and the PPM,
  // operating agreement and investor deck the offering checks read.
  MULTIFAMILY_SYNDICATION: {
    ...MULTIFAMILY,
    id: 'MULTIFAMILY_SYNDICATION',
    slug: 'multifamily-syndication',
    label: COMPANY_TYPE_LABELS.MULTIFAMILY_SYNDICATION,
    importTargets: [...MULTIFAMILY.importTargets, 'SYNDICATION_TRACK_RECORD'],
    findingRules: [...MULTIFAMILY.findingRules, 'syndication-track-record-thin'],
    documentCategories: ['OFFERING_PPM', 'OPERATING_AGREEMENT', 'INVESTOR_DECK'],
  },
  // A buyer acquiring music publishing and master rights (T-140, ADR 0041): the works and rights
  // register, royalty statements and the chain of title are the evidence; the price is a multiple of
  // the trailing, decay-adjusted net income. Billing holds direct licence invoices (sync, if any).
  MUSIC_RIGHTS: {
    ...pack('MUSIC_RIGHTS', 'music-rights', 'media-rights', true),
    importTargets: ['BILLING_INVOICE_LINE', 'MUSIC_WORKS', 'MUSIC_SPLITS', 'MUSIC_TITLE_CHAIN', 'MUSIC_ROYALTY_STATEMENTS'],
    metricCalculator: 'music-royalties',
    findingRules: [
      'music-chain-of-title-gap',
      'music-split-mismatch',
      'music-termination-exposure',
      'music-income-concentration',
      'music-recoupment-mismatch',
      'music-royalty-leakage',
      'music-undisclosed-encumbrance',
      'music-statement-gap',
      'music-verified-growth',
    ],
    valuationMethods: ['ARR_MULTIPLE', 'DCF'],
    methodLabels: {
      ARR_MULTIPLE: {
        label: 'Royalty multiple',
        help: 'Enterprise value = trailing, decay-adjusted net income (net publisher’s share / net label share) × multiple. The Catalog tab computes the income.',
        input: 'Trailing decay-adjusted net income',
      },
    },
    documentCategories: ['ROYALTY_STATEMENT', 'SPLIT_SHEET', 'PUBLISHING_AGREEMENT', 'COPYRIGHT_RECORD', 'LIEN_SEARCH'],
  },
  // A buyer acquiring energy assets (T-142, ADR 0043): power plants and oil & gas mineral, royalty and
  // working interests, two evidence families sharing one title and liability core. Interests value on
  // a reserve-based DCF from the third-party report; plants on $/kW of capacity plus contract coverage.
  ENERGY_GENERATION: {
    ...pack('ENERGY_GENERATION', 'energy-generation', 'energy', true),
    importTargets: ['BILLING_INVOICE_LINE', 'ENERGY_PLANTS', 'ENERGY_INTERESTS', 'ENERGY_LEASES', 'ENERGY_PRODUCTION', 'ENERGY_LIABILITIES'],
    metricCalculator: 'energy-assets',
    findingRules: [
      'energy-unbooked-environmental',
      'energy-aro-shortfall',
      'energy-decline-mismatch',
      'energy-lease-expiry',
      'energy-royalty-decimal',
      'energy-ppa-cliff',
      'energy-title-defect',
      'energy-compliance-capex-gap',
      'energy-reserve-report-missing',
    ],
    valuationMethods: ['DCF', 'ARR_MULTIPLE'],
    methodLabels: {
      DCF: {
        label: 'Reserve-based DCF',
        help: 'Discounted cash flows from the third-party reserve report’s categories and the production history (the Assets tab shows both). Pactlab never estimates reserves.',
        input: 'Revenue',
      },
      ARR_MULTIPLE: {
        label: 'Capacity value ($/kW)',
        help: 'Enterprise value = net capacity in kW × a price per kW, for the plants; contract coverage on the Assets tab says how much of their revenue is under PPA.',
        input: 'Net capacity (kW)',
      },
    },
    documentCategories: ['TITLE_OPINION', 'OIL_GAS_LEASE', 'DIVISION_ORDER', 'RESERVE_REPORT', 'POWER_PURCHASE_AGREEMENT', 'ENVIRONMENTAL_REPORT'],
  },
};

/** The pack for a seller's company type; `OTHER` (or none) reads the software core as it is. */
export function packFor(companyType: CompanyType | null | undefined): PackDefinition {
  return companyType && companyType !== 'OTHER' ? PACKS[companyType] : PACKS.SOFTWARE_SAAS;
}
