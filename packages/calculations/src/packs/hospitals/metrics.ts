import type { MetricCalculator } from '../calculators';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE } from '../pnl-trend';
import { capexYears, CENSUS_MONTH, censusWindow, departmentClusters, HOSPITALS_OPERATIONS_VERSION, hospitalsAnalysisDate, MEDICAL_STAFF, medicalStaff, PAYER_MONTH, payerWindow, staffStatuses } from './operations';

/**
 * The hospitals pack's figures (T-162): net revenue and the largest payer's share from the payer-mix
 * export; admissions, patient days, the average daily census and the average length of stay from the
 * census; capital spend as a share of revenue in the latest imported P&L year; and the medical-staff
 * register at the analysis date. Occupancy needs the beds the cost report states, so it is read on the
 * Hospital tab and by the rules; a verification document can move a licence date there too.
 */
export function hospitalsMetrics(input: PackMetricsInput): PackMetricsReport {
  const payers = payerWindow(input.evidence);
  const payersComplete = payers && payers.missing.length === 0 ? payers : null;
  const census = censusWindow(input.evidence);
  const censusComplete = census && census.missing.length === 0 ? census : null;
  const capex = capexYears(input.evidence).years.at(-1) ?? null;
  const staff = medicalStaff(input.evidence);
  const asOf = hospitalsAnalysisDate(input.evidence);
  const statuses = staffStatuses(staff, [], asOf);
  const missing = (what: string, needs: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs });
  const top = payersComplete?.payers[0] ?? null;
  const metrics: PackMetric[] = [
    {
      key: 'net_revenue',
      label: 'Net revenue, trailing twelve months',
      unit: 'MONEY',
      formula: 'Σ net revenue in the payer-mix export over the twelve months to the latest month',
      sourceCount: payersComplete?.payers.reduce((total, payer) => total + payer.rows.length, 0) ?? 0,
      ...(payersComplete ? { value: payersComplete.netRevenue.toFixed(2) } : missing('payer mix (twelve complete months)', ['HOSPITALS_PAYER_MIX'])),
    },
    {
      key: 'largest_payer_share',
      label: top ? `Largest payer’s share of net revenue (${top.payer})` : 'Largest payer’s share of net revenue',
      unit: 'RATIO',
      formula: 'The largest payer’s net revenue ÷ all net revenue in the payer-mix export, trailing twelve months',
      sourceCount: top?.rows.length ?? 0,
      ...(top?.share ? { value: top.share.toFixed(4) } : missing('payer mix (twelve complete months)', ['HOSPITALS_PAYER_MIX'])),
    },
    {
      key: 'admissions',
      label: 'Admissions, trailing twelve months',
      unit: 'COUNT',
      formula: 'Σ admissions in the census export over the twelve months to the latest month',
      sourceCount: censusComplete?.rows.length ?? 0,
      ...(censusComplete ? { value: censusComplete.admissions.toFixed(0) } : missing('census (twelve complete months)', ['HOSPITALS_CENSUS'])),
    },
    {
      key: 'average_daily_census',
      label: 'Average daily census',
      unit: 'COUNT',
      formula: 'Σ patient days ÷ the days in the twelve months to the latest census month',
      sourceCount: censusComplete?.rows.length ?? 0,
      ...(censusComplete?.averageDailyCensus ? { value: censusComplete.averageDailyCensus.toFixed(1) } : missing('census (twelve complete months)', ['HOSPITALS_CENSUS'])),
    },
    {
      key: 'average_length_of_stay',
      label: 'Average length of stay (days)',
      unit: 'COUNT',
      formula: 'Σ patient days ÷ Σ admissions, trailing twelve months',
      sourceCount: censusComplete?.rows.length ?? 0,
      ...(censusComplete?.averageLengthOfStay ? { value: censusComplete.averageLengthOfStay.toFixed(2) } : missing('census (twelve complete months)', ['HOSPITALS_CENSUS'])),
    },
    {
      key: 'capex_ratio',
      label: capex ? `Capital spend on plant and equipment ÷ revenue (${capex.year})` : 'Capital spend on plant and equipment ÷ revenue',
      unit: 'RATIO',
      formula: 'Capital spend lines ÷ revenue in the latest fiscal year the imported P&L covers in full',
      sourceCount: capex?.evidenceIds.length ?? 0,
      ...(capex?.ratio ? { value: capex.ratio.toFixed(4) } : missing('P&L by year, with its capital spend line', ['FINANCIAL_PNL'])),
    },
    {
      key: 'medical_staff',
      label: 'Medical staff in the register',
      unit: 'COUNT',
      formula: 'Rows in the medical-staff register',
      sourceCount: staff.length,
      ...(staff.length ? { value: String(staff.length) } : missing('medical-staff register', ['HOSPITALS_MEDICAL_STAFF'])),
    },
    {
      key: 'privileges_lapsed',
      label: asOf ? `Clinical privileges lapsed at ${asOf}` : 'Clinical privileges lapsed',
      unit: 'COUNT',
      formula: 'Staff whose privileges passed their reappointment date before the analysis date (or the register says lapsed), not reappointed',
      sourceCount: staff.length,
      ...(staff.length && asOf ? { value: String(statuses.filter((status) => status.privilegesLapsed).length) } : missing('medical-staff register and the census or payer mix', ['HOSPITALS_MEDICAL_STAFF'])),
    },
    {
      key: 'departments_lapsing_together',
      label: 'Departments whose privileges lapse together',
      unit: 'COUNT',
      formula: 'Departments with three or more staff sharing one privilege date that has passed, or falls within 90 days',
      sourceCount: staff.length,
      ...(staff.length && asOf ? { value: String(new Set(departmentClusters(staff, asOf).map((cluster) => cluster.department)).size) } : missing('medical-staff register and the census or payer mix', ['HOSPITALS_MEDICAL_STAFF'])),
    },
    {
      key: 'licences_expired',
      label: asOf ? `Medical-staff licences expired at ${asOf}` : 'Medical-staff licences expired',
      unit: 'COUNT',
      formula: 'Register licences whose expiry passed before the analysis date (or the register says expired)',
      sourceCount: staff.length,
      ...(staff.length && asOf ? { value: String(statuses.filter((status) => status.licenceExpired).length) } : missing('medical-staff register and the census or payer mix', ['HOSPITALS_MEDICAL_STAFF'])),
    },
  ];
  return { calculator: 'hospitals-operations', version: HOSPITALS_OPERATIONS_VERSION, currency: input.currency, metrics };
}

export const HOSPITALS_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'hospitals-operations',
  version: HOSPITALS_OPERATIONS_VERSION,
  evidenceTypes: [CENSUS_MONTH, PAYER_MONTH, MEDICAL_STAFF, PNL_LINE],
  compute: hospitalsMetrics,
};
