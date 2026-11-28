import { D, parseDecimal } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import { INVOICE_LINE, monthName } from '../common';
import { packHistory, withHistory } from '../history';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE } from '../pnl-trend';
import { CAM, CAPEX_ITEM, capexSchedule, creAnalysisDate, CRE_LEASES_VERSION, LEASE, recoveryYears, rentRoll, tenantShares, walt } from './leases';
import { CRE_HISTORY, LEASING_MONTH } from './rules';

type Decimal = InstanceType<typeof D>;
const ratio = (value: Decimal) => value.toFixed(4);
const cash = (value: Decimal) => value.toFixed(2);

/**
 * The commercial property pack's figures (T-165): from the rent roll, in-place rent, the largest tenant's share,
 * the weighted average lease term and the rent expiring within a year of the analysis date; from the CAM
 * reconciliation, the latest year's recovery ratio and unrecovered expenses (with every year read beside the
 * P&L); from the seller's capex schedule, committed and scheduled capex. The leases are documents: the rules read
 * them; these figures read the imports as they are. It never values the property.
 */
export function commercialPropertyMetrics(input: PackMetricsInput): PackMetricsReport {
  const roll = rentRoll(input.evidence);
  const { total, shares } = tenantShares(input.evidence);
  const top = shares[0] ?? null;
  const asOf = creAnalysisDate(input.evidence);
  const years = recoveryYears(input.evidence, null);
  const latest = years.at(-1) ?? null;
  const schedule = capexSchedule(input.evidence);
  const committed = schedule.filter((line) => line.status === 'committed');
  const sumOf = (lines: typeof schedule) => lines.reduce((sum, line) => sum.plus(line.amount), new D(0));
  const needs = (what: string, targets: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs: targets });
  const needRoll = needs('rent roll', ['CRE_RENT_ROLL']);
  const inYear = asOf ? shares.filter(({ entry }) => entry.end && entry.end > asOf && entry.end <= `${Number(asOf.slice(0, 4)) + 1}${asOf.slice(4)}`) : [];
  const waltYears = asOf ? walt(input.evidence, asOf) : null;
  // The leasing history's trailing twelve months (T-184c): occupancy and rent per leased square foot.
  const leasing = input.evidence.filter((row) => row.evidenceType === LEASING_MONTH && /^\d{4}-(0[1-9]|1[0-2])$/.test((row.canonical['month'] ?? '').trim()));
  const leasingMonths = [...new Set(leasing.map((row) => (row.canonical['month'] ?? '').trim()))].sort().slice(-12);
  const trailing = leasing.filter((row) => leasingMonths.includes((row.canonical['month'] ?? '').trim()));
  const sumOfField = (field: string) => trailing.reduce((sum, row) => sum.plus(parseDecimal(row.canonical[field] ?? null) ?? 0), new D(0));
  const leased = sumOfField('leased_sqft');
  const needLeasing = needs('leasing history by month (twelve complete months)', ['CRE_LEASING_HISTORY']);
  const lastMonth = leasingMonths.at(-1) ?? '';
  const metrics: PackMetric[] = [
    { key: 'in_place_rent', label: 'In-place base rent, annual', unit: 'MONEY', formula: 'Σ monthly base rent on the rent roll × 12', sourceCount: roll.length, ...(roll.length ? { value: cash(total.times(12)) } : needRoll) },
    {
      key: 'largest_tenant_share',
      label: top ? `Largest tenant’s share of rent (${top.entry.tenant})` : 'Largest tenant’s share of rent',
      unit: 'RATIO',
      formula: 'The largest tenant’s monthly base rent ÷ all monthly base rent on the rent roll',
      sourceCount: roll.length,
      ...(top ? { value: ratio(top.share) } : needRoll),
    },
    {
      key: 'walt',
      label: 'Weighted average lease term (years)',
      unit: 'COUNT',
      formula: 'Σ (years from the analysis date to each lease end × its share of rent), rent-roll dates',
      sourceCount: roll.length,
      ...(roll.length && waltYears ? { value: waltYears.toFixed(1) } : needs('rent roll and the billing export (for the analysis date)', ['CRE_RENT_ROLL', 'BILLING_INVOICE_LINE'])),
    },
    {
      key: 'rent_expiring_12m',
      label: 'Rent expiring within 12 months',
      unit: 'RATIO',
      formula: 'Share of base rent whose rent-roll lease end falls within 12 months of the analysis date (the rules measure the hold from the expected closing)',
      sourceCount: roll.length,
      ...(roll.length && asOf ? { value: ratio(inYear.reduce((sum, entry) => sum.plus(entry.share), new D(0))) } : needRoll),
    },
    {
      key: 'occupancy',
      label: 'Occupancy, trailing (leased ÷ rentable area)',
      unit: 'RATIO',
      formula: `Σ leased square feet ÷ Σ rentable square feet over ${leasingMonths.length === 12 ? `the twelve months to ${monthName(lastMonth)}` : 'twelve complete months'}, from the leasing history`,
      sourceCount: trailing.length,
      ...(leasingMonths.length === 12 && sumOfField('rentable_sqft').gt(0) ? { value: ratio(leased.div(sumOfField('rentable_sqft'))) } : needLeasing),
    },
    {
      key: 'rent_per_sqft',
      label: 'Base rent per leased sq ft (a year), trailing',
      unit: 'MONEY',
      formula: 'Σ base rent in force ÷ Σ leased square feet over the trailing twelve months, × 12, from the leasing history',
      sourceCount: trailing.length,
      ...(leasingMonths.length === 12 && leased.gt(0) ? { value: cash(sumOfField('base_rent').div(leased).times(12)) } : needLeasing),
    },
    {
      key: 'recovery_ratio',
      label: latest ? `Recoveries billed ÷ recoverable expenses (${latest.year})` : 'Recoveries billed ÷ recoverable expenses',
      unit: 'RATIO',
      formula: 'Σ recoveries billed ÷ Σ recoverable expenses, latest CAM reconciliation year (the rules weigh it against the leases’ shares)',
      sourceCount: latest?.evidenceIds.length ?? 0,
      ...(latest && latest.pool.gt(0) ? { value: ratio(latest.billed.div(latest.pool)) } : needs('CAM reconciliation by year', ['CRE_CAM_RECONCILIATION'])),
    },
    {
      key: 'unrecovered_expenses',
      label: latest ? `Recoverable expenses not billed (${latest.year})` : 'Recoverable expenses not billed',
      unit: 'MONEY',
      formula: 'Σ recoverable expenses − Σ recoveries billed, latest CAM reconciliation year',
      sourceCount: latest?.evidenceIds.length ?? 0,
      ...(latest ? { value: cash(latest.pool.minus(latest.billed)) } : needs('CAM reconciliation by year', ['CRE_CAM_RECONCILIATION'])),
    },
    {
      key: 'committed_capex',
      label: 'Committed capex on the seller’s schedule',
      unit: 'MONEY',
      formula: 'Σ capex schedule lines whose status is committed',
      sourceCount: committed.length,
      ...(schedule.length ? { value: cash(sumOf(committed)) } : needs('seller’s capex schedule', ['CRE_CAPEX_SCHEDULE'])),
    },
    {
      key: 'scheduled_capex',
      label: 'Capex on the seller’s schedule, every line',
      unit: 'MONEY',
      formula: 'Σ capex schedule lines, planned and committed',
      sourceCount: schedule.length,
      ...(schedule.length ? { value: cash(sumOf(schedule)) } : needs('seller’s capex schedule', ['CRE_CAPEX_SCHEDULE'])),
    },
  ];
  // The years side by side (ADR 0057, T-184c): the P&L, occupancy, rent per square foot, expiries and the recovery
  // ratio by year; occupancy, rent per square foot and the recovery ratio carry a History strip.
  const history = packHistory(CRE_HISTORY, input.evidence, input);
  const strips = new Set(['occupancy', 'rent_per_sqft', 'recovery_ratio']);
  return {
    calculator: 'cre-leases',
    version: CRE_LEASES_VERSION,
    currency: input.currency,
    metrics: metrics.map((metric) => (strips.has(metric.key) ? withHistory(metric, history, metric.key) : metric)),
    history: history.table,
  };
}

export const CRE_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'cre-leases',
  version: CRE_LEASES_VERSION,
  evidenceTypes: [LEASE, CAM, CAPEX_ITEM, LEASING_MONTH, INVOICE_LINE, PNL_LINE],
  compute: commercialPropertyMetrics,
};
