import type { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import { monthName } from '../common';
import { packHistory, withHistory } from '../history';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE } from '../pnl-trend';
import { SERVICES_HISTORY } from './rules';
import { AGEING_BAND, ageingByYear, ageingReports, BILLING_MONTH, billingRows, practiceModel, SERVICES_PRACTICE_VERSION, servicesUtilization, TIMESHEET_MONTH } from './practice';

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal) => value.toFixed(2);
const ratio = (value: Decimal) => value.toFixed(4);

/**
 * The professional services pack's figures (T-167): fees, realization and collection over the trailing
 * twelve months from the time-and-billing export; utilization from the timesheets; the largest client,
 * fee-earner and partner book as shares of fees; the recurring share; and the latest WIP and debtor
 * balances over 90 days. The claims, the covenant cover and the trends by year are on the Practice tab
 * and in the rules. Fee-earners are pseudonymous references.
 */
export function servicesMetrics(input: PackMetricsInput): PackMetricsReport {
  const model = practiceModel(billingRows(input.evidence));
  const trailing = model.trailing && model.trailing.missing.length === 0 ? model.trailing : null;
  const usage = servicesUtilization(input.evidence);
  const ageing = ageingByYear(ageingReports(input.evidence));
  const window = trailing ? `the twelve months to ${monthName(trailing.to)}` : 'twelve complete months';
  const missing = (what: string, needs: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs });
  const billing = missing('time-and-billing export (twelve complete months)', ['SERVICES_TIME_BILLING']);
  const share = (label: string, key: string, entry: (typeof model.clients)[number] | undefined): PackMetric => ({
    key,
    label: entry ? `${label} (${entry.key})` : label,
    unit: 'RATIO',
    formula: `The ${label.toLowerCase()}’s fees ÷ all fees billed, ${window}`,
    sourceCount: entry?.rows.length ?? 0,
    ...(trailing && entry?.share ? { value: ratio(entry.share) } : billing),
  });
  const over90 = (ledger: 'wip' | 'ar', label: string): PackMetric => {
    const latest = ageing[ledger]?.at(-1);
    return {
      key: `${ledger}_over_90_share`,
      label: latest ? `${label} over 90 days, ${latest.asOf}` : `${label} over 90 days`,
      unit: 'RATIO',
      formula: 'Balances in the 91–180 and over-180 bands ÷ the ledger’s total, latest ageing report',
      sourceCount: latest?.rows.length ?? 0,
      ...(latest?.over90Share ? { value: ratio(latest.over90Share) } : missing('WIP and debtor ageing reports', ['SERVICES_AGEING'])),
    };
  };
  const metrics: PackMetric[] = [
    { key: 'fees', label: 'Fees billed, trailing', unit: 'MONEY', formula: `Σ billed in ${window}`, sourceCount: trailing?.rows.length ?? 0, ...(trailing ? { value: cash(trailing.billed) } : billing) },
    {
      key: 'utilization',
      label: 'Utilization',
      unit: 'RATIO',
      formula: 'Billable ÷ available hours, the timesheets summary’s last twelve months',
      sourceCount: usage?.rows.length ?? 0,
      ...(usage?.rate ? { value: ratio(usage.rate) } : missing('timesheets summary', ['SERVICES_TIMESHEETS'])),
    },
    { key: 'realization', label: 'Realization', unit: 'RATIO', formula: `Fees billed ÷ standard value of the time worked, ${window}`, sourceCount: trailing?.rows.length ?? 0, ...(trailing?.realization ? { value: ratio(trailing.realization) } : billing) },
    {
      key: 'collection',
      label: 'Collection',
      unit: 'RATIO',
      formula: `Cash collected ÷ fees billed, ${window}`,
      sourceCount: trailing?.rows.length ?? 0,
      ...(trailing?.collection ? { value: ratio(trailing.collection) } : missing('time-and-billing export with collected amounts', ['SERVICES_TIME_BILLING'])),
    },
    share('Largest client', 'largest_client_share', model.clients[0]),
    share('Largest fee-earner', 'largest_fee_earner_share', model.feeEarners[0]),
    share('Largest partner book', 'largest_partner_share', model.partners[0]),
    { key: 'recurring_share', label: 'Recurring fees', unit: 'RATIO', formula: `Retainer and managed-service fees ÷ all fees, ${window}`, sourceCount: trailing?.rows.length ?? 0, ...(trailing && model.recurringShare ? { value: ratio(model.recurringShare) } : billing) },
    over90('wip', 'WIP'),
    over90('ar', 'Debtors'),
  ];
  // Five years (T-184b): the P&L, utilization, realization and headcount by year; utilization and realization carry a History strip.
  const history = packHistory(SERVICES_HISTORY, input.evidence, input);
  const strips = new Set(['utilization', 'realization']);
  return {
    calculator: 'services-practice',
    version: SERVICES_PRACTICE_VERSION,
    currency: input.currency,
    metrics: metrics.map((metric) => (strips.has(metric.key) ? withHistory(metric, history, metric.key) : metric)),
    history: history.table,
  };
}

export const SERVICES_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'services-practice',
  version: SERVICES_PRACTICE_VERSION,
  evidenceTypes: [BILLING_MONTH, TIMESHEET_MONTH, AGEING_BAND, PNL_LINE],
  compute: servicesMetrics,
};
