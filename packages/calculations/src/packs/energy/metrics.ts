import { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import { packHistory, withHistory } from '../history';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE } from '../pnl-trend';
import { ENERGY_HISTORY } from './history';
import { analysisDate, computedCapacityFactor, decimalChecks, ENERGY_DEFAULT_HOLD_YEARS, ENERGY_EVIDENCE_TYPES, energyRows, leaseExposure, productionModel } from './assets';

export const ENERGY_METRICS_VERSION = 'energy-assets-1';

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal) => value.toFixed(2);
const ratio = (value: Decimal) => value.toFixed(4);
const count = (value: number) => String(value);

/**
 * The asset and interest register (T-142) as labelled figures: capacity, generation and contract
 * coverage for the plants; acreage, production, decline and decimals for the interests; the booked
 * liabilities. Reserves are the third-party report's and are confirmed on the Assets tab, never here.
 */
export function energyMetrics(input: PackMetricsInput): PackMetricsReport {
  const rows = energyRows(input.evidence);
  const production = productionModel(rows);
  const missing = (what: string, needs: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs });
  const capacity = rows.plants.reduce((total, plant) => total.plus(plant.capacityMw), new D(0));
  const generation = rows.plants.reduce((total, plant) => total.plus(production.byAsset.get(plant.id)?.trailingMwh ?? new D(0)), new D(0));
  const factors = rows.plants.map((plant) => computedCapacityFactor(plant, production)).filter((factor): factor is Decimal => factor !== null);
  const plantLines = rows.plants.reduce((total, plant) => total + (production.byAsset.get(plant.id)?.lineIds.length ?? 0), 0);
  const interestLines = rows.interests.reduce((total, interest) => total + (production.byAsset.get(interest.id)?.lineIds.length ?? 0), 0);
  const acres = rows.leases.reduce((total, lease) => total.plus(lease.netAcres), new D(0));
  const exposure = leaseExposure(rows, analysisDate(rows), ENERGY_DEFAULT_HOLD_YEARS);
  const decimals = decimalChecks(rows, production);
  const booked = rows.liabilities.reduce((total, line) => total.plus(line.booked), new D(0));
  const bookedAro = rows.liabilities.filter((line) => line.kind === 'aro').reduce((total, line) => total.plus(line.booked), new D(0));
  const metrics: PackMetric[] = [
    { key: 'plants', label: 'Plants in the register', unit: 'COUNT', formula: 'Plants in the plant register', sourceCount: rows.plants.length, ...(rows.plants.length ? { value: count(rows.plants.length) } : missing('plant register', ['ENERGY_PLANTS'])) },
    { key: 'capacity_mw', label: 'Net capacity (MW)', unit: 'COUNT', formula: 'Σ net capacity of the plants', sourceCount: rows.plants.length, ...(rows.plants.length ? { value: capacity.toFixed(1) } : missing('plant register', ['ENERGY_PLANTS'])) },
    { key: 'generation_mwh', label: 'Trailing net generation (MWh)', unit: 'COUNT', formula: `Σ power production in the twelve months to ${production.analysisDate ?? 'the latest period'}`, sourceCount: plantLines, ...(plantLines ? { value: generation.toFixed(0) } : missing('production history', ['ENERGY_PRODUCTION'])) },
    {
      key: 'capacity_factor',
      label: 'Capacity factor (computed)',
      unit: 'RATIO',
      formula: 'Trailing net generation ÷ (net capacity × 8,760 hours), plants with twelve months on file',
      sourceCount: plantLines,
      ...(factors.length ? { value: ratio(factors.reduce((total, factor) => total.plus(factor), new D(0)).div(factors.length)) } : missing('plant register and twelve months of production history', ['ENERGY_PLANTS', 'ENERGY_PRODUCTION'])),
    },
    { key: 'plant_revenue', label: 'Plant revenue (trailing)', unit: 'MONEY', formula: 'Σ trailing plant revenue', sourceCount: plantLines, ...(plantLines ? { value: cash(production.plantTrailingRevenue) } : missing('production history', ['ENERGY_PRODUCTION'])) },
    {
      key: 'contracted_share',
      label: 'Contract coverage',
      unit: 'RATIO',
      formula: 'Trailing plant revenue sold under contract ÷ trailing plant revenue',
      sourceCount: plantLines,
      ...(production.plantTrailingRevenue.gt(0) ? { value: ratio(production.plantContractedRevenue.div(production.plantTrailingRevenue)) } : missing('production history', ['ENERGY_PRODUCTION'])),
    },
    { key: 'interests', label: 'Oil & gas interests', unit: 'COUNT', formula: 'Interests in the interest register', sourceCount: rows.interests.length, ...(rows.interests.length ? { value: count(rows.interests.length) } : missing('interest register', ['ENERGY_INTERESTS'])) },
    { key: 'net_acres', label: 'Net acres', unit: 'COUNT', formula: 'Σ net acres on the lease schedule', sourceCount: rows.leases.length, ...(rows.leases.length ? { value: acres.toFixed(2) } : missing('lease schedule', ['ENERGY_LEASES'])) },
    { key: 'trailing_boe', label: 'Trailing production (BOE)', unit: 'COUNT', formula: 'Σ oil and NGL barrels + gas mcf ÷ 6, twelve months, gross', sourceCount: interestLines, ...(interestLines ? { value: production.interestTrailingBoe.toFixed(0) } : missing('production history', ['ENERGY_PRODUCTION'])) },
    {
      key: 'decline',
      label: 'Annual decline (actual)',
      unit: 'RATIO',
      formula: '1 − trailing ÷ prior-year BOE',
      sourceCount: interestLines,
      ...(production.interestDecline ? { value: ratio(production.interestDecline) } : missing('production history (two years)', ['ENERGY_PRODUCTION'])),
    },
    { key: 'interest_revenue', label: 'Interest revenue, gross (trailing)', unit: 'MONEY', formula: 'Σ trailing gross (8/8ths) revenue of the interests', sourceCount: interestLines, ...(interestLines ? { value: cash(production.interestTrailingRevenue) } : missing('production history', ['ENERGY_PRODUCTION'])) },
    { key: 'decimal_errors', label: 'Division-order decimals off the lease chain', unit: 'COUNT', formula: 'Interests whose division-order NRI differs from the recomputed royalty chain', sourceCount: rows.interests.length, ...(rows.interests.length && rows.leases.length ? { value: count(decimals.length) } : missing('interest register and lease schedule', ['ENERGY_INTERESTS', 'ENERGY_LEASES'])) },
    {
      key: 'lease_exposed_share',
      label: `Acreage expiring within ${ENERGY_DEFAULT_HOLD_YEARS} years, not held by production`,
      unit: 'RATIO',
      formula: `Net acres not held by production whose primary term ends within ${ENERGY_DEFAULT_HOLD_YEARS} years of the latest period ÷ all net acres`,
      sourceCount: rows.leases.length,
      ...(exposure.share ? { value: ratio(exposure.share) } : missing('lease schedule and production history', ['ENERGY_LEASES', 'ENERGY_PRODUCTION'])),
    },
    { key: 'booked_liabilities', label: 'Booked liabilities', unit: 'MONEY', formula: 'Σ the seller’s liability schedule', sourceCount: rows.liabilities.length, ...(rows.liabilities.length ? { value: cash(booked) } : missing('liability schedule', ['ENERGY_LIABILITIES'])) },
    { key: 'booked_aro', label: 'Booked asset-retirement obligation', unit: 'MONEY', formula: 'Σ schedule lines of kind aro', sourceCount: rows.liabilities.length, ...(rows.liabilities.length ? { value: cash(bookedAro) } : missing('liability schedule', ['ENERGY_LIABILITIES'])) },
  ];
  // Five years (T-184b): production by year beside any imported P&L; generation_mwh carries a History strip.
  const history = packHistory(ENERGY_HISTORY, input.evidence, input);
  return {
    calculator: 'energy-assets',
    version: ENERGY_METRICS_VERSION,
    currency: input.currency,
    metrics: metrics.map((metric) => (metric.key === 'generation_mwh' ? withHistory(metric, history, 'power_mwh') : metric)),
    history: history.table,
  };
}

export const ENERGY_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'energy-assets',
  version: ENERGY_METRICS_VERSION,
  evidenceTypes: [...ENERGY_EVIDENCE_TYPES, PNL_LINE],
  compute: energyMetrics,
};
