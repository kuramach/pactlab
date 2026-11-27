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
export const METRIC_CALCULATOR_IDS = ['saas-metrics', 'multifamily-metrics', 'music-royalties', 'energy-assets', 'spv-round', 'fintech-payments', 'healthcare-collections', 'clinics-practice', 'pharma-pipeline', 'ecommerce-channels', 'services-practice', 'telecom-subscribers'] as const;
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
  /** Common inputs this pack needs where its cluster leaves them optional (a clinic's lease, T-161). */
  readonly requiredInputs?: readonly ExpectedInput['id'][];
  /** Imports this pack offers as an alternative form of another, so intake never asks for them (rent-roll snapshots beside the occupancy history, T-183). */
  readonly optionalInputs?: readonly ExpectedInput['id'][];
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
  // Five years of history (T-183, ADR 0057): the P&L by year (a core import), occupancy and rent by month or
  // year, and rent-roll snapshots, read beside the T-12 and the current rent roll.
  importTargets: ['BILLING_INVOICE_LINE', 'MULTIFAMILY_RENT_ROLL', 'MULTIFAMILY_T12', 'MULTIFAMILY_DELINQUENCY', 'MULTIFAMILY_INSPECTION', 'MULTIFAMILY_OCCUPANCY', 'MULTIFAMILY_RENT_ROLL_HISTORY'],
  // Snapshots are another form of the occupancy history: offered, never asked for.
  optionalInputs: ['MULTIFAMILY_RENT_ROLL_HISTORY'],
  metricCalculator: 'multifamily-metrics',
  findingRules: [
    'multifamily-om-noi',
    'multifamily-deferred-maintenance',
    'multifamily-delinquency-concentration',
    'multifamily-loss-to-lease',
    'multifamily-below-market-range',
    'multifamily-occupancy-erosion',
    'multifamily-rent-below-expense-growth',
    'multifamily-noi-spike',
    'multifamily-pnl-trend',
    'multifamily-pnl-margin-drift',
    'multifamily-pnl-expense-outpacing',
  ],
  valuationMethods: ['NOI_CAP_RATE', 'DCF'],
};

// Founder-side (T-083): the founder's own startup is the seller; investors are the counterparty.
const VENTURE_RAISE: PackDefinition = {
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
};

export const PACKS: Readonly<Record<PackId, PackDefinition>> = {
  SOFTWARE_SAAS: {
    ...pack('SOFTWARE_SAAS', 'software-saas', 'technology', true),
    findingRules: ['saas-reported-arr', 'saas-revenue-concentration', 'saas-customer-change-of-control', 'saas-hidden-contraction'],
  },
  // Payments and lending (T-058, extended by T-159, ADR 0050): the software path runs as it is; the
  // pack adds the loan tape and AML alerts, the processor export (volume, take rate and loss rates
  // recomputed), the licence and sponsor register, the compliance evidence and the multi-year P&L trend.
  FINTECH: {
    ...pack('FINTECH', 'fintech', 'technology', true),
    importTargets: ['BILLING_INVOICE_LINE', 'FINTECH_LOAN_TAPE', 'FINTECH_AML_ALERT', 'FINTECH_PROCESSOR_VOLUME', 'FINTECH_LICENCES'],
    metricCalculator: 'fintech-payments',
    findingRules: [
      'fintech-credit-loss',
      'fintech-aml-unreviewed',
      'fintech-partner-bank-coc',
      'fintech-volume-claims',
      'fintech-revenue-reconciliation',
      'fintech-licence-status',
      'fintech-loss-thresholds',
      'fintech-compliance-evidence',
      'fintech-pnl-trend',
      'fintech-pnl-margin-drift',
      'fintech-pnl-expense-outpacing',
      'fintech-take-rate-trend',
      'fintech-loss-rate-trend',
    ],
    documentCategories: ['REGULATORY_LICENCE', 'SPONSOR_BANK_AGREEMENT', 'PCI_ATTESTATION', 'AML_PROGRAM', 'REGULATORY_EXAM'],
  },
  // Provider services (T-061, extended by T-160, ADR 0051): the parent pack for clinics and hospitals. The T-061
  // rules stay first; the pack adds remittances and collections by clinician (payer mix, denials, days in AR,
  // the deck's claims, the P&L reconciled by year), the credentialing and payer contract registers, clinician
  // concentration, compliance evidence and the multi-year P&L trend.
  HEALTHCARE: {
    ...pack('HEALTHCARE', 'healthcare', 'healthcare', true),
    importTargets: [
      'BILLING_INVOICE_LINE',
      'HEALTHCARE_CLAIMS_SUMMARY',
      'HEALTHCARE_PROVIDER_ROSTER',
      'HEALTHCARE_REMITTANCES',
      'HEALTHCARE_CLINICIAN_COLLECTIONS',
      'HEALTHCARE_CREDENTIALS',
      'HEALTHCARE_PAYER_CONTRACTS',
    ],
    metricCalculator: 'healthcare-collections',
    findingRules: [
      'healthcare-government-concentration',
      'healthcare-director-fee',
      'healthcare-privacy-assessment',
      'healthcare-credentials-expiring',
      'healthcare-practice-claims',
      'healthcare-collections-reconciliation',
      'healthcare-collections-trend',
      'healthcare-payer-mix-shift',
      'healthcare-credentialing',
      'healthcare-clinician-concentration',
      'healthcare-payer-contracts',
      'healthcare-compliance-evidence',
      'healthcare-pnl-trend',
      'healthcare-pnl-margin-drift',
      'healthcare-pnl-expense-outpacing',
    ],
    documentCategories: ['LICENCE_VERIFICATION', 'CODING_AUDIT', 'HIPAA_RISK_ASSESSMENT', 'PAYER_CONTRACT', 'RESTRICTIVE_COVENANTS'],
    // Healthtech targets also run the software path (ARR multiple); services value on DCF.
    valuationMethods: ['DCF', 'ARR_MULTIPLE'],
  },
  // Subscriber claims, rights windows and revenue concentration (T-062, extended by T-168, ADR 0056). The T-062
  // rules stay first; the pack adds the subscriber claims register (subscribers, churn and ARPU recomputed from
  // the movements export), the rights and carriage register against the expected closing, advertising and
  // affiliate concentration by counterparty, content cost and capex against flat ARPU, and the P&L trend.
  TELECOM_MEDIA: {
    ...pack('TELECOM_MEDIA', 'telecom-media', 'technology', true),
    importTargets: ['BILLING_INVOICE_LINE', 'TELECOM_SUBSCRIBERS', 'TELECOM_SUBSCRIBER_MOVEMENTS', 'TELECOM_AGREEMENTS', 'TELECOM_REVENUE_STREAMS', 'TELECOM_CAPEX'],
    metricCalculator: 'telecom-subscribers',
    findingRules: [
      'telecom-reported-subscribers',
      'telecom-churn-turning',
      'telecom-regional-concentration',
      'telecom-wholesale-review',
      'telecom-subscriber-claims',
      'telecom-rights-window',
      'telecom-counterparty-concentration',
      'telecom-content-squeeze',
      'telecom-capex-squeeze',
      'telecom-pnl-trend',
      'telecom-pnl-margin-drift',
      'telecom-pnl-expense-outpacing',
      'telecom-churn-trend',
    ],
    documentCategories: ['RIGHTS_AGREEMENT'],
    // Subscriber revenue runs the SaaS metrics as they are (ARPU ≈ MRR per account, churn ≈ logo churn).
  },
  // Utilization, realization and the people the fees depend on (T-063, extended by T-167, ADR 0055). The
  // T-063 rules stay first; the pack adds the concentration claims register (fees by client and by partner
  // against the deck's ceilings), the realization trend by year, fees reconciled to the P&L, the WIP and
  // debtor ageing drift, the covenant register for rainmakers, the recurring revenue split and the P&L trend.
  PROFESSIONAL_SERVICES: {
    ...pack('PROFESSIONAL_SERVICES', 'professional-services', 'services', true),
    importTargets: ['BILLING_INVOICE_LINE', 'SERVICES_TIMESHEETS', 'SERVICES_HEADCOUNT', 'SERVICES_TIME_BILLING', 'SERVICES_AGEING'],
    metricCalculator: 'services-practice',
    findingRules: [
      'services-utilization-gap',
      'services-client-termination',
      'services-delivery-attrition',
      'services-concentration-claims',
      'services-realization-trend',
      'services-fee-reconciliation',
      'services-ageing-drift',
      'services-rainmaker-coverage',
      'services-revenue-quality',
      'services-pnl-trend',
      'services-pnl-margin-drift',
      'services-pnl-expense-outpacing',
    ],
    documentCategories: ['COVENANT_REGISTER'],
    // People-driven earnings value on DCF; retainer revenue also reads as recurring.
    valuationMethods: ['DCF', 'ARR_MULTIPLE'],
  },
  // Pipeline claims, patent cliffs and licence obligations, checked against documents (T-064, extended by
  // T-163, ADR 0053). The T-064 rules stay first; the pack adds the pipeline claims register (the registry
  // records and correspondence), the patent estate against the hold, the obligations recomputed from the
  // agreements, manufacturing and key-scientist dependence, R&D burn against the timeline and the P&L trend.
  PHARMA_BIOTECH: {
    ...pack('PHARMA_BIOTECH', 'pharma-biotech', 'life-sciences', true),
    importTargets: ['BILLING_INVOICE_LINE', 'PHARMA_PATENTS', 'PHARMA_TRIAL_REGISTRY', 'PHARMA_PIPELINE', 'PHARMA_OBLIGATIONS', 'PHARMA_RD_ROSTER'],
    metricCalculator: 'pharma-pipeline',
    findingRules: [
      'pharma-patent-before-forecast',
      'pharma-supplier-observations',
      'pharma-partner-concentration',
      'pharma-pipeline-claims',
      'pharma-patent-cliff',
      'pharma-obligations',
      'pharma-manufacturing-dependence',
      'pharma-key-scientist',
      'pharma-burn-vs-timeline',
      'pharma-pnl-trend',
      'pharma-pnl-margin-drift',
      'pharma-pnl-expense-outpacing',
    ],
    documentCategories: ['REGULATORY_CORRESPONDENCE', 'PATENT_RECORD', 'LICENCE_AGREEMENT', 'SUPPLY_AGREEMENT'],
    // The registry records import before the pipeline, so the claims the pipeline's import checks read them.
    // Royalty and product revenue value on DCF, with exclusivity and approval timing as scenario inputs.
    valuationMethods: ['DCF'],
  },
  // Channel economics, cohort value and platform dependence (T-065, extended by T-164, ADR 0054). The
  // T-065 rules stay first; the pack adds the unit-economics claims register (LTV on a contribution basis,
  // CAC), channel revenue reconciled to the P&L by year, platform-account ownership from the documents,
  // the return-rate trend, inventory ageing, the CAC and contribution trend by year and the P&L trend.
  ECOMMERCE_DTC: {
    ...pack('ECOMMERCE_DTC', 'ecommerce-dtc', 'consumer', true),
    importTargets: ['BILLING_INVOICE_LINE', 'ECOMMERCE_COHORTS', 'ECOMMERCE_AD_SPEND', 'ECOMMERCE_CHANNEL_ORDERS', 'ECOMMERCE_INVENTORY'],
    metricCalculator: 'ecommerce-channels',
    findingRules: [
      'ecommerce-marketplace-majority',
      'ecommerce-cohort-repeat-decline',
      'ecommerce-channel-cac-rising',
      'ecommerce-unit-economics-claims',
      'ecommerce-channel-reconciliation',
      'ecommerce-platform-ownership',
      'ecommerce-return-rate-trend',
      'ecommerce-inventory-ageing',
      'ecommerce-unit-economics-trend',
      'ecommerce-pnl-trend',
      'ecommerce-pnl-margin-drift',
      'ecommerce-pnl-expense-outpacing',
    ],
    documentCategories: ['PLATFORM_ACCOUNT_RECORD', 'MARKETPLACE_AGREEMENT'],
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
  // Few-site clinics (T-068, extended by T-161, ADR 0052): the healthcare pack scaled down. The T-068 rules
  // stay first; the T-160 evidence set is reused by reference (its targets and rules, never copied); the pack
  // adds the owner-operator's share by service line, referral concentration, the clinic lease and the
  // multi-year P&L trend.
  SMALL_CLINICS: {
    ...pack('SMALL_CLINICS', 'small-clinics', 'healthcare', true),
    importTargets: [
      'BILLING_INVOICE_LINE',
      'CLINICS_PATIENT_VOLUME',
      'CLINICS_EQUIPMENT',
      'CLINICS_CODING_SUMMARY',
      'HEALTHCARE_REMITTANCES',
      'HEALTHCARE_CLINICIAN_COLLECTIONS',
      'HEALTHCARE_CREDENTIALS',
      'HEALTHCARE_PAYER_CONTRACTS',
      'CLINICS_SERVICE_LINES',
      'CLINICS_REFERRALS',
    ],
    metricCalculator: 'clinics-practice',
    // Extends healthcare (T-061, T-160): its reimbursement, credentialing and compliance rules run here too.
    // Clinician concentration is left to the owner-operator check: in a clinic the largest clinician is the seller.
    findingRules: [
      'clinics-provider-carries-site',
      'clinics-coding-above-policy',
      'clinics-equipment-past-life',
      'healthcare-government-concentration',
      'healthcare-director-fee',
      'healthcare-privacy-assessment',
      'healthcare-practice-claims',
      'healthcare-collections-reconciliation',
      'healthcare-collections-trend',
      'healthcare-payer-mix-shift',
      'healthcare-credentialing',
      'healthcare-payer-contracts',
      'healthcare-compliance-evidence',
      'clinics-owner-dependence',
      'clinics-referral-concentration',
      'clinics-premises',
      'clinics-pnl-trend',
      'clinics-pnl-margin-drift',
      'clinics-pnl-expense-outpacing',
    ],
    documentCategories: ['LICENCE_VERIFICATION', 'CODING_AUDIT', 'HIPAA_RISK_ASSESSMENT', 'PAYER_CONTRACT'],
    // The premises check reads the clinic lease, so intake asks for it.
    requiredInputs: ['LEASE'],
    valuationMethods: ['DCF'],
  },
  HOSPITALS: {
    ...pack('HOSPITALS', 'hospitals', 'healthcare', true),
    importTargets: ['BILLING_INVOICE_LINE', 'HOSPITALS_CENSUS', 'HOSPITALS_PAYER_MIX'],
    // Extends healthcare (T-061): its compliance rules run too; payer concentration reads the payer mix instead of billing.
    findingRules: ['hospitals-payer-concentration', 'hospitals-accreditation-transfer', 'hospitals-physician-dependence', 'hospitals-regulatory-capex', 'healthcare-director-fee', 'healthcare-privacy-assessment'],
    valuationMethods: ['PAYER_MIX_EBITDA', 'DCF'],
  },
  VENTURE_RAISE,
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
  // An organizer pools investors into one vehicle for one startup round (T-141, ADR 0044). The
  // startup's evidence is Venture Raise's by reference (billing, the cap table with its SAFEs and
  // notes, monthly cash and burn); the pack adds the round-math, claims, vehicle-economics,
  // side-letter and Form D checks, and the vehicle's documents. Seats, accreditation and the
  // published investor view live on the SPV tab.
  STARTUP_SPV: {
    ...pack('STARTUP_SPV', 'startup-spv', 'capital', true),
    importTargets: VENTURE_RAISE.importTargets,
    metricCalculator: 'spv-round',
    findingRules: ['spv-cap-table-math', 'spv-instrument-terms', 'spv-round-claims', 'spv-fee-carry', 'spv-side-letters', 'spv-form-d'],
    // The vehicle buys in at the round's price; the round's pre-money is the price it pays for its line.
    valuationMethods: ['ROUND_PRE_MONEY', 'ARR_MULTIPLE'],
    documentCategories: ['ROUND_SUMMARY', 'CONVERTIBLE_INSTRUMENT', 'SPV_OPERATING_AGREEMENT', 'SPV_INVESTOR_SUMMARY', 'SIDE_LETTER', 'FORM_D'],
  },
};

/** The pack for a seller's company type; `OTHER` (or none) reads the software core as it is. */
export function packFor(companyType: CompanyType | null | undefined): PackDefinition {
  return companyType && companyType !== 'OTHER' ? PACKS[companyType] : PACKS.SOFTWARE_SAAS;
}
