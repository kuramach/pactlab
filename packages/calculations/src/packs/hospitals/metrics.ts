import type { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import { monthName } from '../common';
import { CREDENTIAL, PAYER_CONTRACT, ROSTER } from '../healthcare/practice';
import { packHistory, withHistory } from '../history';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE } from '../pnl-trend';
import {
  contractRegister,
  COST_REPORT,
  costReportYears,
  HOSPITAL_CAPEX,
  HOSPITAL_CENSUS,
  HOSPITAL_PAYER,
  hospitalCapexYears,
  hospitalsAnalysisDate,
  HOSPITALS_OPERATIONS_VERSION,
  payerWindow,
  privilegeClusters,
  staffCredentials,
} from './operations';
import { HOSPITALS_HISTORY } from './rules';

type Decimal = InstanceType<typeof D>;
const ratio = (value: Decimal) => value.toFixed(4);
const cash = (value: Decimal) => value.toFixed(2);
const count = (value: number) => String(value);

/**
 * The hospitals pack's figures (T-162): from the latest filed cost report, occupancy, the Medicare and
 * Medicaid shares of patient days and cost per patient day; from the census, admissions over the trailing
 * twelve months (with five years of history); the largest payer's share of net revenue; payer contracts
 * ending within a year of the analysis date; credentials lapsed and departments whose privileges lapse
 * together; and the latest year's capex ÷ revenue. Documents can move a date or the closing: the rules read
 * them; these figures read the registers as imported.
 */
export function hospitalsMetrics(input: PackMetricsInput): PackMetricsReport {
  const reports = costReportYears(input.evidence);
  const latest = reports.at(-1) ?? null;
  const needs = (what: string, targets: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs: targets });
  const needCostReport = needs('filed cost reports (statistics and total costs by fiscal year)', ['HOSPITALS_COST_REPORT']);
  const census = input.evidence.filter((row) => row.evidenceType === HOSPITAL_CENSUS);
  const months = [...new Set(census.map((row) => (row.canonical['month'] ?? '').trim()))].filter((month) => /^\d{4}-\d{2}$/.test(month)).sort().slice(-12);
  const trailing = census.filter((row) => months.includes((row.canonical['month'] ?? '').trim()));
  const admissions = trailing.reduce((total, row) => total + Number(row.canonical['admissions'] ?? 0), 0);
  const payers = payerWindow(input.evidence);
  const top = payers && payers.missing.length === 0 ? (payers.payers[0] ?? null) : null;
  const asOf = hospitalsAnalysisDate(input.evidence);
  const register = contractRegister(input.evidence, []);
  const staff = staffCredentials(input.evidence, [], asOf);
  const clusters = privilegeClusters(staff);
  const capex = hospitalCapexYears(input.evidence).at(-1) ?? null;
  const fy = latest ? `FY${latest.year}` : 'the latest year';
  const metrics: PackMetric[] = [
    { key: 'occupancy', label: `Occupancy (${fy} cost report)`, unit: 'RATIO', formula: 'Patient days ÷ bed days available, from the latest filed cost report', sourceCount: latest ? 1 : 0, ...(latest?.occupancy ? { value: ratio(latest.occupancy) } : needCostReport) },
    { key: 'medicare_share', label: `Medicare share of patient days (${fy})`, unit: 'RATIO', formula: 'Medicare days ÷ patient days, latest cost report', sourceCount: latest ? 1 : 0, ...(latest?.medicareShare ? { value: ratio(latest.medicareShare) } : needCostReport) },
    { key: 'medicaid_share', label: `Medicaid share of patient days (${fy})`, unit: 'RATIO', formula: 'Medicaid days ÷ patient days, latest cost report', sourceCount: latest ? 1 : 0, ...(latest?.medicaidShare ? { value: ratio(latest.medicaidShare) } : needCostReport) },
    { key: 'cost_per_patient_day', label: `Cost per patient day (${fy})`, unit: 'MONEY', formula: 'Total costs ÷ patient days, latest cost report', sourceCount: latest ? 1 : 0, ...(latest?.costPerPatientDay ? { value: cash(latest.costPerPatientDay) } : needCostReport) },
    {
      key: 'admissions',
      label: 'Admissions, trailing',
      unit: 'COUNT',
      formula: `Σ admissions in ${months.length === 12 ? `the twelve months to ${monthName(months.at(-1) ?? '')}` : 'twelve complete months'}, every service line`,
      sourceCount: trailing.length,
      ...(months.length === 12 ? { value: count(admissions) } : needs('census by month and service line (twelve complete months)', ['HOSPITALS_CENSUS'])),
    },
    {
      key: 'top_payer_share',
      label: top ? `Largest payer’s share of net revenue (${top.payer})` : 'Largest payer’s share of net revenue',
      unit: 'RATIO',
      formula: 'The largest payer’s net revenue ÷ all net revenue in the payer mix, trailing twelve months',
      sourceCount: top?.rows.length ?? 0,
      ...(top?.share ? { value: ratio(top.share) } : needs('payer mix by month (twelve complete months)', ['HOSPITALS_PAYER_MIX'])),
    },
    {
      key: 'contracts_in_window',
      label: 'Material payer contracts ending within a year',
      unit: 'COUNT',
      formula: 'Payers at 10% or more of trailing net revenue whose agreement ends within 12 months of the analysis date without automatic renewal (the rules measure from the expected closing)',
      sourceCount: register.payers.length,
      ...(register.payers.length && input.evidence.some((row) => row.evidenceType === PAYER_CONTRACT)
        ? { value: count(register.payers.filter((status) => status.state === 'ENDS_IN_WINDOW' || status.state === 'ENDS_BEFORE_CLOSING').length) }
        : needs('payer contract register and the payer mix', ['HEALTHCARE_PAYER_CONTRACTS', 'HOSPITALS_PAYER_MIX'])),
    },
    {
      key: 'credentials_lapsed',
      label: 'Medical-staff credentials lapsed',
      unit: 'COUNT',
      formula: 'Licences and privileges expired, suspended or past their date at the end of the latest month in the exports',
      sourceCount: staff.length,
      ...(staff.length ? { value: count(staff.filter((entry) => entry.state === 'LAPSED').length) } : needs('medical-staff register (licences and privileges)', ['HEALTHCARE_CREDENTIALS'])),
    },
    {
      key: 'departments_lapsing_together',
      label: 'Departments whose privileges lapse together',
      unit: 'COUNT',
      formula: 'Departments where two or more physicians, and half the department, share one lapsed or near-expiry privilege date',
      sourceCount: staff.filter((entry) => entry.isPrivilege).length,
      ...(staff.some((entry) => entry.isPrivilege) ? { value: count(new Set(clusters.map((cluster) => cluster.department)).size) } : needs('medical-staff register with privileges by department', ['HEALTHCARE_CREDENTIALS'])),
    },
    {
      key: 'capex_ratio',
      label: capex ? `Capex ÷ revenue (FY${capex.year})` : 'Capex ÷ revenue',
      unit: 'RATIO',
      formula: 'Capital expenditure from its import ÷ the imported P&L’s revenue, latest fiscal year both hold',
      sourceCount: capex ? capex.capexIds.length : 0,
      ...(capex?.ratio ? { value: ratio(capex.ratio) } : needs('capital expenditure by fiscal year and the P&L', ['HOSPITALS_CAPEX', 'FINANCIAL_PNL'])),
    },
  ];
  // Five years (T-184c): the P&L, admissions and patient days by year; admissions carries a History strip.
  const history = packHistory(HOSPITALS_HISTORY, input.evidence, input);
  return {
    calculator: 'hospitals-operations',
    version: HOSPITALS_OPERATIONS_VERSION,
    currency: input.currency,
    metrics: metrics.map((metric) => (metric.key === 'admissions' ? withHistory(metric, history, 'admissions') : metric)),
    history: history.table,
  };
}

export const HOSPITALS_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'hospitals-operations',
  version: HOSPITALS_OPERATIONS_VERSION,
  evidenceTypes: [COST_REPORT, HOSPITAL_CAPEX, HOSPITAL_CENSUS, HOSPITAL_PAYER, PAYER_CONTRACT, CREDENTIAL, ROSTER, PNL_LINE],
  compute: hospitalsMetrics,
};
