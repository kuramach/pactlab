import { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { monthName } from '../common';
import { packHistory, withHistory } from '../history';
import { PNL_LINE } from '../pnl-trend';
import { FINTECH_HISTORY } from './rules';
import { ALERT, FINTECH_PAYMENTS_VERSION, fintechAnalysisDate, LICENCE, licenceRows, licenceStatuses, LOAN, PROCESSOR_MONTH, processorMonths, quarterlyRates, volumeModel } from './payments';

type Decimal = InstanceType<typeof D>;
const cash = (value: Decimal) => value.toFixed(2);
const ratio = (value: Decimal) => value.toFixed(4);
const count = (value: number | Decimal) => (typeof value === 'number' ? String(value) : value.toFixed(0));

/**
 * The fintech pack's figures (T-159): processed volume, transactions, net revenue and the effective
 * take rate recomputed from the processor exports; the latest quarter's chargeback and fraud-loss
 * rates; the licence register at the analysis date; and the loan tape's loss rate and the AML alerts.
 * Thresholds and claims are the documents' and are checked on the Payments tab and by the rules.
 */
export function fintechMetrics(input: PackMetricsInput): PackMetricsReport {
  const rows = processorMonths(input.evidence);
  const model = volumeModel(rows);
  const trailing = model.trailing && model.trailing.missing.length === 0 ? model.trailing : null;
  const quarter = quarterlyRates(rows).at(-1) ?? null;
  const licences = licenceStatuses(licenceRows(input.evidence), [], fintechAnalysisDate(rows));
  const loans = input.evidence.filter((row) => row.evidenceType === LOAN);
  const originated = loans.reduce((total, row) => total.plus(row.canonical['principal'] ?? '0'), new D(0));
  const chargedOff = loans.filter((row) => row.canonical['status'] === 'charged_off').reduce((total, row) => total.plus(row.canonical['principal'] ?? '0'), new D(0));
  const closed = input.evidence.filter((row) => row.evidenceType === ALERT && row.canonical['status'] === 'closed');
  const unreviewed = closed.filter((row) => row.canonical['review_evidence'] !== 'yes');
  const window = trailing ? `the twelve months to ${monthName(trailing.to)}` : 'twelve complete months';
  const missing = (what: string, needs: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs });
  const volumeNeeds = missing('processor export (twelve complete months)', ['FINTECH_PROCESSOR_VOLUME']);
  const metrics: PackMetric[] = [
    { key: 'tpv', label: 'Processed volume (TPV), trailing', unit: 'MONEY', formula: `Σ processed volume in ${window}, every processor`, sourceCount: trailing?.rows.length ?? 0, ...(trailing ? { value: cash(trailing.volume) } : volumeNeeds) },
    { key: 'tpv_growth', label: 'TPV growth, year on year', unit: 'RATIO', formula: 'Trailing twelve months ÷ the twelve before − 1', sourceCount: (trailing?.rows.length ?? 0) + (model.prior?.rows.length ?? 0), ...(model.growth ? { value: ratio(model.growth) } : missing('processor export (two complete years)', ['FINTECH_PROCESSOR_VOLUME'])) },
    { key: 'transactions', label: 'Transactions, trailing', unit: 'COUNT', formula: `Σ settled transactions in ${window}`, sourceCount: trailing?.rows.length ?? 0, ...(trailing ? { value: count(trailing.transactions) } : volumeNeeds) },
    { key: 'net_revenue', label: 'Net revenue on volume, trailing', unit: 'MONEY', formula: `Σ net revenue in ${window}`, sourceCount: trailing?.rows.length ?? 0, ...(trailing ? { value: cash(trailing.netRevenue) } : volumeNeeds) },
    { key: 'take_rate', label: 'Effective take rate', unit: 'RATIO', formula: 'Trailing net revenue ÷ trailing processed volume', sourceCount: trailing?.rows.length ?? 0, ...(trailing?.takeRate ? { value: trailing.takeRate.toFixed(6) } : volumeNeeds) },
    {
      key: 'chargeback_rate',
      label: `Chargeback rate${quarter ? `, ${quarter.quarter}` : ''}`,
      unit: 'RATIO',
      formula: 'Chargebacks ÷ settled transactions, by count, in the latest complete quarter',
      sourceCount: quarter?.rows.length ?? 0,
      ...(quarter?.chargebackRate ? { value: quarter.chargebackRate.toFixed(6) } : missing('processor export (a complete quarter)', ['FINTECH_PROCESSOR_VOLUME'])),
    },
    {
      key: 'fraud_rate',
      label: `Fraud-loss rate${quarter ? `, ${quarter.quarter}` : ''}`,
      unit: 'RATIO',
      formula: 'Fraud losses ÷ processed volume in the latest complete quarter',
      sourceCount: quarter?.rows.length ?? 0,
      ...(quarter?.fraudRate ? { value: quarter.fraudRate.toFixed(6) } : missing('processor export with fraud losses (a complete quarter)', ['FINTECH_PROCESSOR_VOLUME'])),
    },
    { key: 'licences', label: 'Licences and sponsor agreements', unit: 'COUNT', formula: 'Rows in the licence and sponsor register', sourceCount: licences.length, ...(licences.length ? { value: count(licences.length) } : missing('licence and sponsor register', ['FINTECH_LICENCES'])) },
    {
      key: 'licences_lapsed',
      label: 'Lapsed at the analysis date',
      unit: 'COUNT',
      formula: 'Register rows lapsed, surrendered or revoked, or past their expiry at the end of the latest processor month (documents can move a date on the Payments tab)',
      sourceCount: licences.length,
      ...(licences.length ? { value: count(licences.filter((status) => status.state === 'LAPSED').length) } : missing('licence and sponsor register', ['FINTECH_LICENCES'])),
    },
    { key: 'loan_loss_rate', label: 'Charged-off share of originated principal', unit: 'RATIO', formula: 'Σ principal of charged-off loans ÷ Σ originated principal, loan tape', sourceCount: loans.length, ...(originated.gt(0) ? { value: ratio(chargedOff.div(originated)) } : missing('loan tape', ['FINTECH_LOAN_TAPE'])) },
    { key: 'aml_unreviewed', label: 'Closed alerts without review evidence', unit: 'RATIO', formula: 'Closed alerts with no review evidence ÷ closed alerts', sourceCount: closed.length, ...(closed.length ? { value: ratio(new D(unreviewed.length).div(closed.length)) } : missing('AML alerts', ['FINTECH_AML_ALERT'])) },
  ];
  // Five years (T-184): the P&L and the export by year; TPV, take rate and loss rate carry a History strip.
  const history = packHistory(FINTECH_HISTORY, input.evidence);
  const strips: Readonly<Record<string, string>> = { tpv: 'tpv', take_rate: 'take_rate' };
  return {
    calculator: 'fintech-payments',
    version: FINTECH_PAYMENTS_VERSION,
    currency: input.currency,
    metrics: metrics.map((metric) => (strips[metric.key] ? withHistory(metric, history, strips[metric.key] as string) : metric)),
    history: history.table,
  };
}

export const FINTECH_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'fintech-payments',
  version: FINTECH_PAYMENTS_VERSION,
  evidenceTypes: [PROCESSOR_MONTH, LICENCE, LOAN, ALERT, PNL_LINE],
  compute: fintechMetrics,
};
