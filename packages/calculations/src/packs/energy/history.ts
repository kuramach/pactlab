import { driverTrendRule, recentRunRule, type DriverSpec, type PackHistorySpec } from '../history';
import { ENERGY_EVIDENCE } from './assets';

/**
 * Five years of history for energy assets (T-184b, ADR 0057): production by calendar year from the production
 * history export, the plant's net generation and the wells' oil and gas, each a sum of its product's volumes.
 * The wells' decline against the reserve report is energy-decline-mismatch's; the plant's generation falling
 * every year is the driver trend below. An imported P&L shows beside the production.
 */
const product = (name: string) => ({ field: 'product', values: [name] });

export const ENERGY_DRIVERS = {
  power: { key: 'power_mwh', label: 'Net generation (MWh)', unit: 'COUNT', evidenceType: ENERGY_EVIDENCE.PRODUCTION, monthField: 'period_end', mode: 'SUM', numerator: ['volume'], numeratorWhere: product('power'), formula: 'Σ power volumes in the year, every plant' },
  oil: { key: 'oil_bbl', label: 'Oil (barrels)', unit: 'COUNT', evidenceType: ENERGY_EVIDENCE.PRODUCTION, monthField: 'period_end', mode: 'SUM', numerator: ['volume'], numeratorWhere: product('oil'), formula: 'Σ oil volumes in the year, every interest (gross)' },
  gas: { key: 'gas_mcf', label: 'Gas (mcf)', unit: 'COUNT', evidenceType: ENERGY_EVIDENCE.PRODUCTION, monthField: 'period_end', mode: 'SUM', numerator: ['volume'], numeratorWhere: product('gas'), formula: 'Σ gas volumes in the year, every interest (gross)' },
} as const satisfies Record<string, DriverSpec>;

export const ENERGY_HISTORY: PackHistorySpec = {
  drivers: [ENERGY_DRIVERS.power, ENERGY_DRIVERS.oil, ENERGY_DRIVERS.gas],
  keyExpenses: [],
  driverImport: 'ENERGY_PRODUCTION',
  driverLabel: 'Production history',
  driverWhat: 'production history',
};

/** A plant's net generation falling every year by this share or more, first year to last (10%). */
export const GENERATION_DECLINE_SHARE = '0.1';

export const ENERGY_GENERATION_TREND = driverTrendRule(
  {
    id: 'energy-generation-trend',
    driver: ENERGY_DRIVERS.power,
    adverse: 'DOWN',
    threshold: GENERATION_DECLINE_SHARE,
    domain: 'OPERATIONAL',
    advice: 'The plant runs less each year: check outages, dispatch and the capacity factor the capacity value and the DCF assume before carrying today\'s output forward.',
  },
  ENERGY_HISTORY,
);

/** The recent run against the long run (T-185). */
export const ENERGY_RECENT_RUN = recentRunRule('energy', ENERGY_HISTORY);
