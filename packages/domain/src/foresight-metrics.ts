import type { PackId } from './packs/registry';

/**
 * Foresight key metrics (T-094 B10): what each pact forecasts for five
 * years, numerically. Macro metrics have published external forecasts (IMF
 * World Economic Outlook); sector metrics have none published freely, so
 * they carry an AI forecast and the user's own. How a metric moves value is
 * a versioned elasticity: the gap between the forecast and the metric's
 * neutral level, in percentage points, shifts yearly growth and the discount
 * rate by these factors. All values are percent per year.
 */
export interface ForesightMetric {
  readonly key: string;
  readonly label: string;
  readonly help: string;
  /** IMF DataMapper indicator for a published forecast, when one exists. */
  readonly external: 'PCPIPCH' | 'NGDP_RPCH' | null;
  /** The level at which the metric neither helps nor hurts value (percent a year, decimal string). */
  readonly neutral: string;
  /** Growth points per point above neutral, and discount-rate points per point above neutral. */
  readonly growthPerPoint: string;
  readonly discountPerPoint: string;
}

export const FORESIGHT_METRICS_VERSION = 'foresight-metrics-1';

const MACRO: readonly ForesightMetric[] = [
  {
    key: 'inflation',
    label: 'Inflation (consumer prices)',
    help: 'Price rises pass partly into revenue, and push interest rates and the discount rate up.',
    external: 'PCPIPCH',
    neutral: '2',
    growthPerPoint: '0.5',
    discountPerPoint: '0.75',
  },
  {
    key: 'gdp_growth',
    label: 'Real GDP growth',
    help: 'A stronger economy lifts demand for the business’s products.',
    external: 'NGDP_RPCH',
    neutral: '2',
    growthPerPoint: '0.75',
    discountPerPoint: '0',
  },
];

const sector = (key: string, label: string, help: string, neutral: string, growthPerPoint = '0.5'): ForesightMetric => ({
  key,
  label,
  help,
  external: null,
  neutral,
  growthPerPoint,
  discountPerPoint: '0',
});

const SECTOR: Readonly<Record<PackId, ForesightMetric>> = {
  SOFTWARE_SAAS: sector('it_spend_growth', 'Business software spending growth', 'What customers spend on software sets the market the business sells into.', '6'),
  FINTECH: sector('payments_volume_growth', 'Digital payments volume growth', 'Fee revenue follows the volume of payments processed.', '8'),
  HEALTHCARE: sector('healthcare_spend_growth', 'Healthcare spending growth', 'Payers’ spending sets the volume and price of care.', '5'),
  TELECOM_MEDIA: sector('broadband_arpu_growth', 'Broadband revenue per user growth', 'Price per subscriber drives revenue on a largely fixed network.', '2'),
  PROFESSIONAL_SERVICES: sector('consulting_demand_growth', 'Consulting and IT services demand growth', 'Client budgets set utilization and rates.', '4'),
  PHARMA_BIOTECH: sector('drug_price_change', 'Net drug price change', 'Net prices after rebates move revenue directly.', '1'),
  ECOMMERCE_DTC: sector('online_retail_growth', 'Online retail sales growth', 'The channel’s growth carries the brand’s.', '7'),
  MULTIFAMILY: sector('market_rent_growth', 'Market rent growth', 'Rents reset to market as leases turn over.', '3', '0.75'),
  COMMERCIAL_PROPERTY: sector('commercial_rent_growth', 'Commercial rent growth', 'Rents reset to market at lease rollover.', '2', '0.75'),
  HOTELS: sector('revpar_growth', 'RevPAR growth (revenue per available room)', 'Room revenue per available room drives hotel earnings.', '3', '0.75'),
  SMALL_CLINICS: sector('reimbursement_change', 'Reimbursement rate change', 'Payer rates set revenue per visit.', '2'),
  HOSPITALS: sector('reimbursement_change', 'Reimbursement rate change', 'Payer rates set revenue per admission.', '2'),
  VENTURE_RAISE: sector('vc_funding_growth', 'Venture funding growth', 'How much capital investors deploy sets round sizes and prices.', '0', '0.25'),
};

/** The metrics a pact forecasts: macro first, then its sector's. */
export function foresightMetricsFor(pack: PackId | null): readonly ForesightMetric[] {
  return [...MACRO, ...(pack ? [SECTOR[pack]] : [SECTOR.SOFTWARE_SAAS])];
}

/** IMF DataMapper area for a reporting currency: the euro area for EUR. */
export function macroAreaFor(currency: string): string | null {
  return ({ USD: 'USA', EUR: 'EURO', GBP: 'GBR' } as Record<string, string>)[currency] ?? null;
}
