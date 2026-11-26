import { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import { PNL_LINE } from '../pnl-trend';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { capexSchedule, creAnalysisDate, CRE_CAM, CRE_CAPEX, CRE_LEASE, CRE_LEASES_VERSION, rentRoll, statementYears } from './leases';

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal) => value.toFixed(2);
const ratio = (value: Decimal) => value.toFixed(4);
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

/**
 * The commercial-property pack's figures (T-165), from the imports alone: in-place base rent and the largest
 * tenant's share from the rent roll; the rent-weighted average lease term and the rent expiring within two
 * years of the analysis date; CAM recoveries against expenses; the statements' recoveries against their
 * recoverable lines; and committed and scheduled capex. Rent recomputed from the leases, recoveries against
 * the leases' shares, the obligations register, the expiry cliff against the hold and the condition items
 * read the documents, so they are on the Leases tab and in the rules. No property value is estimated.
 */
export function commercialPropertyMetrics(input: PackMetricsInput): PackMetricsReport {
  const roll = rentRoll(input.evidence);
  const asOf = creAnalysisDate(input.evidence);
  const total = roll.reduce((sum, row) => sum.plus(row.rent), new D(0));
  const largest = [...roll].sort((a, b) => b.rent.comparedTo(a.rent))[0] ?? null;
  const dated = roll.filter((row) => row.leaseEnd !== null);
  const remaining = (row: (typeof roll)[number]) => (asOf && row.leaseEnd ? D.max(0, new D(dayNumber(row.leaseEnd) - dayNumber(asOf)).div('365.25')) : new D(0));
  const walt = asOf && total.gt(0) ? dated.reduce((sum, row) => sum.plus(row.rent.times(remaining(row))), new D(0)).div(total) : null;
  const expiring = asOf ? roll.filter((row) => row.leaseEnd !== null && remaining(row).lte(2)) : [];
  const expiringRent = expiring.reduce((sum, row) => sum.plus(row.rent), new D(0));
  const cam = input.evidence.filter((row) => row.evidenceType === CRE_CAM && /^\d{4}$/.test(row.canonical['year'] ?? ''));
  const camYear = cam.map((row) => row.canonical['year'] ?? '').sort().at(-1);
  const camRows = cam.filter((row) => row.canonical['year'] === camYear);
  const sumOf = (rows: typeof camRows, field: string) => rows.reduce((sum, row) => sum.plus(new D(/^-?\d+(\.\d+)?$/.test(row.canonical[field] ?? '') ? (row.canonical[field] as string) : '0')), new D(0));
  const camExpenses = sumOf(camRows, 'expenses');
  const statements = statementYears(input.evidence).at(-1) ?? null;
  const schedule = capexSchedule(input.evidence);
  const committed = schedule.filter((item) => item.status === 'committed');
  const open = schedule.filter((item) => item.status !== 'completed');
  const sum = (items: typeof schedule) => items.reduce((total, item) => total.plus(item.amount), new D(0));
  const missing = (what: string, needs: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs });
  const noRoll = missing('commercial rent roll', ['CRE_RENT_ROLL']);
  const metrics: PackMetric[] = [
    { key: 'in_place_rent', label: 'In-place base rent, annual', unit: 'MONEY', formula: 'Σ monthly base rent on the rent roll × 12', sourceCount: roll.length, ...(roll.length ? { value: cash(total.times(12)) } : noRoll) },
    {
      key: 'largest_tenant_share',
      label: largest ? `Largest tenant (${largest.tenant})` : 'Largest tenant',
      unit: 'RATIO',
      formula: 'The largest monthly base rent ÷ all monthly base rent, rent roll',
      sourceCount: roll.length,
      ...(largest && total.gt(0) ? { value: ratio(largest.rent.div(total)) } : noRoll),
    },
    {
      key: 'walt_years',
      label: asOf ? `Weighted average lease term at ${asOf} (years)` : 'Weighted average lease term (years)',
      unit: 'RATIO',
      formula: 'Σ base rent × years to lease end ÷ Σ base rent, rent roll, from the analysis date (the last billed month)',
      sourceCount: dated.length,
      ...(walt ? { value: walt.toFixed(2) } : missing('commercial rent roll and the billing export (for the analysis date)', ['CRE_RENT_ROLL', 'BILLING_INVOICE_LINE'])),
    },
    {
      key: 'rent_expiring_24m',
      label: 'Rent expiring within two years',
      unit: 'RATIO',
      formula: 'Base rent on leases ending within two years of the analysis date ÷ all base rent, rent roll',
      sourceCount: expiring.length,
      ...(asOf && total.gt(0) ? { value: ratio(expiringRent.div(total)) } : missing('commercial rent roll and the billing export (for the analysis date)', ['CRE_RENT_ROLL', 'BILLING_INVOICE_LINE'])),
    },
    {
      key: 'cam_recovery_ratio',
      label: camYear ? `CAM recovered, ${camYear}` : 'CAM recovered',
      unit: 'RATIO',
      formula: 'Σ recoveries ÷ Σ expenses in the latest CAM reconciliation year',
      sourceCount: camRows.length,
      ...(camExpenses.gt(0) ? { value: ratio(sumOf(camRows, 'recoveries').div(camExpenses)) } : missing('CAM reconciliation', ['CRE_CAM_RECONCILIATION'])),
    },
    {
      key: 'statement_recovery_ratio',
      label: statements ? `Recoveries billed ÷ recoverable expenses, ${statements.year}` : 'Recoveries billed ÷ recoverable expenses',
      unit: 'RATIO',
      formula: 'The statements’ recovery revenue ÷ their real-estate tax, insurance, repairs, security, common-area and utility lines, latest complete year',
      sourceCount: statements ? statements.recoveryIds.length + statements.poolIds.length : 0,
      ...(statements && statements.recoverablePool.gt(0) && statements.recoveryIds.length ? { value: ratio(statements.recoveriesBilled.div(statements.recoverablePool)) } : missing('P&L by year (with its recovery and expense lines)', ['FINANCIAL_PNL'])),
    },
    { key: 'committed_capex', label: 'Committed capex', unit: 'MONEY', formula: 'Σ committed projects in the capex schedule', sourceCount: committed.length, ...(schedule.length ? { value: cash(sum(committed)) } : missing('capex schedule', ['CRE_CAPEX_SCHEDULE'])) },
    { key: 'scheduled_capex', label: 'Capex scheduled, not completed', unit: 'MONEY', formula: 'Σ planned and committed projects in the capex schedule', sourceCount: open.length, ...(schedule.length ? { value: cash(sum(open)) } : missing('capex schedule', ['CRE_CAPEX_SCHEDULE'])) },
  ];
  return { calculator: 'commercial-property-leases', version: CRE_LEASES_VERSION, currency: input.currency, metrics };
}

export const COMMERCIAL_PROPERTY_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'commercial-property-leases',
  version: CRE_LEASES_VERSION,
  evidenceTypes: [CRE_LEASE, CRE_CAM, CRE_CAPEX, PNL_LINE, 'billing.invoice_line'],
  compute: commercialPropertyMetrics,
};
