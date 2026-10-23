import { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { DELINQUENCY, INSPECTION, lossToLease, occupied, of, T12, total, UNIT } from './shared';

export const MULTIFAMILY_METRICS_VERSION = 'multifamily-metrics-1';

const ratio = (value: InstanceType<typeof D>) => value.toFixed(4);
const cash = (value: InstanceType<typeof D>) => value.toFixed(2);

/** Property metrics from the rent roll, T-12, delinquency report and inspections (T-059). */
export function multifamilyMetrics(input: PackMetricsInput): PackMetricsReport {
  const units = of(input.evidence, UNIT);
  const months = of(input.evidence, T12);
  const delinquent = of(input.evidence, DELINQUENCY);
  const inspections = of(input.evidence, INSPECTION);
  const live = occupied(units);
  const ltl = lossToLease(units);
  const missing = (what: string) => ({ value: null, unavailableReason: `Import the ${what}.` });
  const metrics: PackMetric[] = [
    {
      key: 'occupancy',
      label: 'Physical occupancy',
      unit: 'RATIO',
      formula: 'Occupied units ÷ units on the rent roll',
      sourceCount: units.length,
      ...(units.length ? { value: ratio(new D(live.length).div(units.length)) } : missing('rent roll')),
    },
    {
      key: 'units',
      label: 'Units',
      unit: 'COUNT',
      formula: 'Units on the rent roll',
      sourceCount: units.length,
      ...(units.length ? { value: String(units.length) } : missing('rent roll')),
    },
    {
      key: 'annual_in_place_rent',
      label: 'Annual in-place rent',
      unit: 'MONEY',
      formula: 'Σ in-place monthly rent of occupied units × 12',
      sourceCount: live.length,
      ...(units.length ? { value: cash(total(live, 'in_place_rent').times(12)) } : missing('rent roll')),
    },
    {
      key: 'loss_to_lease',
      label: 'Loss-to-lease',
      unit: 'RATIO',
      formula: 'Σ(market − in-place rent) ÷ Σ market rent, occupied units',
      sourceCount: live.length,
      ...(ltl ? { value: ratio(ltl.ratio) } : missing('rent roll with market rents')),
    },
    {
      key: 't12_noi',
      label: 'Net operating income (T-12)',
      unit: 'MONEY',
      formula: 'Σ net operating income over the trailing twelve months',
      sourceCount: months.length,
      ...(months.length ? { value: cash(total(months, 'net_operating_income')) } : missing('T-12 operating statement')),
    },
    {
      key: 'delinquent_balance',
      label: 'Delinquent balance',
      unit: 'MONEY',
      formula: 'Σ balance due on the delinquency report',
      sourceCount: delinquent.length,
      ...(delinquent.length || units.length ? { value: cash(total(delinquent, 'balance_due')) } : missing('delinquency report')),
    },
    {
      key: 'delinquent_units',
      label: 'Delinquent units',
      unit: 'COUNT',
      formula: 'Units on the delinquency report',
      sourceCount: delinquent.length,
      value: String(delinquent.length),
    },
    {
      key: 'capex_per_door',
      label: 'Repair estimate per door',
      unit: 'MONEY',
      formula: 'Σ estimated repair cost from inspections ÷ units on the rent roll',
      sourceCount: inspections.length,
      ...(inspections.length && units.length ? { value: cash(total(inspections, 'estimated_repair_cost').div(units.length)) } : missing('rent roll and unit inspections')),
    },
  ];
  return { calculator: 'multifamily-metrics', version: MULTIFAMILY_METRICS_VERSION, currency: input.currency, metrics };
}

export const MULTIFAMILY_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'multifamily-metrics',
  version: MULTIFAMILY_METRICS_VERSION,
  evidenceTypes: [UNIT, T12, DELINQUENCY, INSPECTION],
  compute: multifamilyMetrics,
};
