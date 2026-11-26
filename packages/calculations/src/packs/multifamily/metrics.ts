import { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { MARKET_RENT, MARKET_RENTS_NEED, marketComparison } from './market-rents';
import { DELINQUENCY, INSPECTION, lossToLease, occupied, of, T12, total, UNIT } from './shared';

/** 2 (T-158): market rent and loss-to-lease vs market from RentCast estimates; the rent roll's own loss-to-lease is labelled apart. */
export const MULTIFAMILY_METRICS_VERSION = 'multifamily-metrics-2';

const ratio = (value: InstanceType<typeof D>) => value.toFixed(4);
const cash = (value: InstanceType<typeof D>) => value.toFixed(2);

/** Property metrics from the rent roll, T-12, delinquency report and inspections (T-059), and market rents (T-158). */
export function multifamilyMetrics(input: PackMetricsInput): PackMetricsReport {
  const units = of(input.evidence, UNIT);
  const months = of(input.evidence, T12);
  const delinquent = of(input.evidence, DELINQUENCY);
  const inspections = of(input.evidence, INSPECTION);
  const live = occupied(units);
  const ltl = lossToLease(units);
  const missing = (what: string, needs: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs });
  const RENT_ROLL = ['MULTIFAMILY_RENT_ROLL'];
  const vsMarket = marketComparison(units, input.evidence);
  const estimates = of(input.evidence, MARKET_RENT);
  const coverage = `${vsMarket.covered.length} of ${vsMarket.occupied} occupied units have an estimate`;
  // A market figure: missing until the rent roll and the estimates are in, and only in the estimates' currency.
  const market = (value: () => string) =>
    !units.length
      ? missing('rent roll', RENT_ROLL)
      : estimates.length === 0
        ? { value: null, unavailableReason: 'Check rents against the market (RentCast).', needs: [MARKET_RENTS_NEED] }
        : vsMarket.currencies.some((currency) => currency !== input.currency)
          ? { value: null, unavailableReason: `Market estimates are in ${vsMarket.currencies.join(', ')}; this pact reports in ${input.currency}.` }
          : vsMarket.covered.length === 0 || vsMarket.market.isZero()
            ? { value: null, unavailableReason: 'No occupied unit\'s floor plan has a market estimate yet: check rents against the market again.', needs: [MARKET_RENTS_NEED] }
            : { value: value() };
  const cited = { source: 'RentCast', evidenceIds: vsMarket.estimates.map((row) => row.id), sourceCount: vsMarket.covered.length + vsMarket.estimates.length };
  const metrics: PackMetric[] = [
    {
      key: 'occupancy',
      label: 'Physical occupancy',
      unit: 'RATIO',
      formula: 'Occupied units ÷ units on the rent roll',
      sourceCount: units.length,
      ...(units.length ? { value: ratio(new D(live.length).div(units.length)) } : missing('rent roll', RENT_ROLL)),
    },
    {
      key: 'units',
      label: 'Units',
      unit: 'COUNT',
      formula: 'Units on the rent roll',
      sourceCount: units.length,
      ...(units.length ? { value: String(units.length) } : missing('rent roll', RENT_ROLL)),
    },
    {
      key: 'annual_in_place_rent',
      label: 'Annual in-place rent',
      unit: 'MONEY',
      formula: 'Σ in-place monthly rent of occupied units × 12',
      sourceCount: live.length,
      ...(units.length ? { value: cash(total(live, 'in_place_rent').times(12)) } : missing('rent roll', RENT_ROLL)),
    },
    {
      key: 'loss_to_lease',
      label: 'Loss-to-lease (from the rent roll)',
      unit: 'RATIO',
      formula: 'Σ(market − in-place rent) ÷ Σ market rent, occupied units, market rent as the rent roll states it',
      sourceCount: live.length,
      source: 'Rent roll',
      ...(ltl ? { value: ratio(ltl.ratio) } : missing('rent roll with market rents', RENT_ROLL)),
    },
    {
      key: 'market_rent_annual',
      label: 'Market rent, annual (from RentCast)',
      unit: 'MONEY',
      formula: `Σ RentCast estimate for each occupied unit's floor plan × 12 (${coverage})`,
      ...cited,
      ...market(() => cash(vsMarket.market.times(12))),
    },
    {
      key: 'loss_to_lease_market',
      label: 'Loss-to-lease vs market (from RentCast)',
      unit: 'RATIO',
      formula: `Σ(RentCast estimate − in-place rent) ÷ Σ RentCast estimate, occupied units (${coverage})`,
      ...cited,
      ...market(() => ratio(vsMarket.market.minus(vsMarket.inPlace).div(vsMarket.market))),
    },
    {
      key: 't12_noi',
      label: 'Net operating income (T-12)',
      unit: 'MONEY',
      formula: 'Σ net operating income over the trailing twelve months',
      sourceCount: months.length,
      ...(months.length ? { value: cash(total(months, 'net_operating_income')) } : missing('T-12 operating statement', ['MULTIFAMILY_T12'])),
    },
    {
      key: 'delinquent_balance',
      label: 'Delinquent balance',
      unit: 'MONEY',
      formula: 'Σ balance due on the delinquency report',
      sourceCount: delinquent.length,
      ...(delinquent.length || units.length ? { value: cash(total(delinquent, 'balance_due')) } : missing('delinquency report', ['MULTIFAMILY_DELINQUENCY'])),
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
      ...(inspections.length && units.length ? { value: cash(total(inspections, 'estimated_repair_cost').div(units.length)) } : missing('rent roll and unit inspections', [...(units.length ? [] : RENT_ROLL), 'MULTIFAMILY_INSPECTION'])),
    },
  ];
  return { calculator: 'multifamily-metrics', version: MULTIFAMILY_METRICS_VERSION, currency: input.currency, metrics };
}

export const MULTIFAMILY_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'multifamily-metrics',
  version: MULTIFAMILY_METRICS_VERSION,
  evidenceTypes: [UNIT, T12, DELINQUENCY, INSPECTION, MARKET_RENT],
  compute: multifamilyMetrics,
};
