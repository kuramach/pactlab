import { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE } from '../pnl-trend';
import { HISTORY_NEEDS, historyTable, multifamilyHistory, OCCUPANCY, UNIT_SNAPSHOT, yearRanges, type MultifamilyHistory } from './history';
import { MARKET_RENT, MARKET_RENTS_NEED, marketComparison } from './market-rents';
import { DELINQUENCY, INSPECTION, lossToLease, occupied, of, T12, total, UNIT } from './shared';

/**
 * 2 (T-158): market rent and loss-to-lease vs market from RentCast estimates; the rent roll's own loss-to-lease is labelled apart.
 * 3 (T-183): five years of history — income, NOI, the expense ratio, occupancy and rent by year, growth rates and coverage.
 */
export const MULTIFAMILY_METRICS_VERSION = 'multifamily-metrics-3';

/** The history figures (T-183): each by year where it has one, with its coverage; a missing figure names the import it needs. */
function historyMetrics(history: MultifamilyHistory): PackMetric[] {
  const op = history.operating;
  const occ = history.occupancy;
  const opCoverage = history.coverage.operating.summary;
  const occCoverage = history.coverage.occupancy.summary;
  // Each year names the rows it rests on (T-179), so a critical rated on the year can cite them.
  const series = <T extends { year: string; evidenceIds: readonly string[] }>(years: readonly T[], value: (year: T) => string | null) =>
    history.expected.map((year) => {
      const found = years.find((entry) => entry.year === year);
      return { period: `FY${year}`, value: found ? value(found) : null, ...(found ? { evidenceIds: found.evidenceIds } : {}) };
    });
  const lastOp = op.at(-1);
  const lastOcc = occ.at(-1);
  const need = (kind: keyof typeof HISTORY_NEEDS, why: string) => ({ value: null, unavailableReason: why, needs: [HISTORY_NEEDS[kind]] });
  const opRows = (years: readonly { evidenceIds: readonly string[] }[]) => years.reduce((count, year) => count + year.evidenceIds.length, 0);
  const span = (years: readonly { year: string }[]) => (years.length ? yearRanges([years[0]?.year ?? '', years.at(-1)?.year ?? '']) : '');
  const growth = (value: string | null, years: readonly { year: string }[], kind: keyof typeof HISTORY_NEEDS, what: string) =>
    value !== null ? { value } : years.length < 2 ? need(kind, `Needs two years or more of ${what}; ${years.length === 0 ? 'none is' : 'one is'} imported.`) : need(kind, `Not computed: the first or last year is not positive.`);
  const rented = occ.filter((year) => year.averageRent !== null);
  return [
    {
      key: 'egi',
      label: 'Effective gross income (latest year)',
      unit: 'MONEY',
      formula: `Revenue on the P&L for ${lastOp ? `FY${lastOp.year}` : 'the latest year'}: rent net of vacancy and concessions, plus other income`,
      sourceCount: lastOp?.evidenceIds.length ?? 0,
      history: series(op, (year) => year.revenue),
      coverage: opCoverage,
      ...(lastOp ? { value: lastOp.revenue } : need('operating', 'Import the operating statements (P&L) by year.')),
    },
    {
      key: 'noi_latest',
      label: 'Net operating income (latest year)',
      unit: 'MONEY',
      formula: `Revenue less operating expenses for ${lastOp ? `FY${lastOp.year}${lastOp.basis === 'T12' ? ' (the T-12)' : ''}` : 'the latest year'}`,
      sourceCount: lastOp?.evidenceIds.length ?? 0,
      history: series(op, (year) => year.noi),
      coverage: opCoverage,
      ...(lastOp ? { value: lastOp.noi } : need('operating', 'Import the operating statements (P&L) by year.')),
    },
    {
      key: 'expense_ratio',
      label: 'Expense ratio (latest year)',
      unit: 'RATIO',
      formula: 'Operating expenses ÷ revenue',
      sourceCount: lastOp?.evidenceIds.length ?? 0,
      history: series(op, (year) => year.expenseRatio),
      coverage: opCoverage,
      ...(lastOp?.expenseRatio ? { value: lastOp.expenseRatio } : need('operating', 'Import the operating statements (P&L) by year.')),
    },
    {
      key: 'noi_cagr',
      label: 'NOI growth, compound annual',
      unit: 'RATIO',
      formula: `(Last year's NOI ÷ first year's) ^ (1 ÷ years between) − 1${op.length > 1 ? `, ${span(op)}` : ''}`,
      sourceCount: opRows(op),
      coverage: opCoverage,
      ...growth(history.noiCagr, op, 'operating', 'operating statements'),
    },
    {
      key: 'revenue_cagr',
      label: 'Revenue growth, compound annual',
      unit: 'RATIO',
      formula: `(Last year's revenue ÷ first year's) ^ (1 ÷ years between) − 1${op.length > 1 ? `, ${span(op)}` : ''}`,
      sourceCount: opRows(op),
      coverage: opCoverage,
      ...growth(history.revenueCagr, op, 'operating', 'operating statements'),
    },
    {
      key: 'occupancy_average',
      label: 'Occupancy, average (latest year)',
      unit: 'RATIO',
      formula: 'Occupied units ÷ units across the year\'s months',
      sourceCount: lastOcc?.evidenceIds.length ?? 0,
      history: series(occ, (year) => year.average),
      coverage: occCoverage,
      ...(lastOcc ? { value: lastOcc.average } : need('occupancy', 'Import the occupancy and rent history.')),
    },
    {
      key: 'occupancy_low',
      label: 'Occupancy, low point (latest year)',
      unit: 'RATIO',
      formula: `The year's lowest month${lastOcc ? ` (${lastOcc.lowPeriod})` : ''}`,
      sourceCount: lastOcc?.evidenceIds.length ?? 0,
      history: series(occ, (year) => year.low),
      coverage: occCoverage,
      ...(lastOcc ? { value: lastOcc.low } : need('occupancy', 'Import the occupancy and rent history.')),
    },
    {
      key: 'vacancy_trailing_3y',
      label: 'Vacancy, trailing three-year average',
      unit: 'RATIO',
      formula: `1 − the mean of each year's average occupancy, ${history.trailingVacancy.years.length ? yearRanges(history.trailingVacancy.years) : 'the last three years'} (${history.trailingVacancy.years.length} of 3 years)`,
      sourceCount: occ.slice(-3).reduce((count, year) => count + year.evidenceIds.length, 0),
      coverage: occCoverage,
      ...(history.trailingVacancy.value !== null ? { value: history.trailingVacancy.value } : need('occupancy', 'Import the occupancy and rent history.')),
    },
    {
      key: 'average_rent',
      label: 'Average in-place rent (latest year)',
      unit: 'MONEY',
      formula: 'Monthly in-place rent of occupied units, weighted by occupied units across the year',
      sourceCount: rented.at(-1)?.evidenceIds.length ?? 0,
      history: series(occ, (year) => year.averageRent),
      coverage: occCoverage,
      ...(rented.at(-1)?.averageRent ? { value: rented.at(-1)?.averageRent ?? null } : need('occupancy', 'Import the occupancy and rent history with average rents.')),
    },
    {
      key: 'rent_growth',
      label: 'Average rent growth per year',
      unit: 'RATIO',
      formula: `(Last year's average rent ÷ first year's) ^ (1 ÷ years between) − 1${rented.length > 1 ? `, ${span(rented)}` : ''}`,
      sourceCount: rented.reduce((count, year) => count + year.evidenceIds.length, 0),
      coverage: occCoverage,
      ...growth(history.rentCagr, rented, 'occupancy', 'average rents'),
    },
  ];
}

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
  const history = multifamilyHistory(input.evidence, input.currency);
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
    ...historyMetrics(history),
  ];
  return { calculator: 'multifamily-metrics', version: MULTIFAMILY_METRICS_VERSION, currency: input.currency, metrics, history: historyTable(history) };
}

export const MULTIFAMILY_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'multifamily-metrics',
  version: MULTIFAMILY_METRICS_VERSION,
  evidenceTypes: [UNIT, T12, DELINQUENCY, INSPECTION, MARKET_RENT, PNL_LINE, OCCUPANCY, UNIT_SNAPSHOT],
  compute: multifamilyMetrics,
};
