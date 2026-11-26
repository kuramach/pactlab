import { D, parseDecimal } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { trendOf } from '../pnl-trend';
import { INVOICE_LINE, rowMonth } from '../common';
import { modelObligations, OBLIGATION, PATENT, PHARMA_KEY_EXPENSES, PHARMA_PIPELINE_VERSION, PROGRAMME, programmes, REGISTRY_TRIAL, registryTrials, SCIENTIST } from './pipeline';

/**
 * The pharma and biotech pack's figures (T-163): what the imports hold — the pipeline's programmes and
 * how many have a registered trial, the patent families, the milestones the seller's model carries, the
 * trailing billed revenue, and R&D in the latest imported P&L year and its share of revenue. The checks
 * that read documents (claims, cliffs against the hold, obligations against the agreements) are on the
 * Pipeline tab and in the rules.
 */
export function pharmaMetrics(input: PackMetricsInput): PackMetricsReport {
  const pipeline = programmes(input.evidence);
  const trials = registryTrials(input.evidence);
  const registered = pipeline.filter((entry) => trials.some((trial) => trial.programme.toLowerCase() === entry.programme.toLowerCase()));
  const patents = input.evidence.filter((row) => row.evidenceType === PATENT);
  const families = new Set(patents.map((row) => row.canonical['family'] ?? '').filter(Boolean));
  const milestones = modelObligations(input.evidence).filter((row) => row.kind === 'milestone' && row.amount);
  const lines = input.evidence.filter((row) => row.evidenceType === INVOICE_LINE && rowMonth(row));
  const latest = lines.map((row) => rowMonth(row) as string).sort().at(-1);
  const trailing = latest
    ? (() => {
        const [year = 0, month = 0] = latest.split('-').map(Number);
        const first = month === 12 ? `${year}-01` : `${year - 1}-${String(month + 1).padStart(2, '0')}`;
        const own = lines.filter((row) => (rowMonth(row) as string) >= first && row.canonical['currency'] === input.currency);
        return { rows: own.length, amount: own.reduce((total, row) => total.plus(parseDecimal(row.canonical['amount']) ?? 0), new D(0)) };
      })()
    : null;
  const year = trendOf(input.evidence, PHARMA_KEY_EXPENSES).years.at(-1);
  const rd = year?.ratios.find((ratio) => ratio.key === 'rd');
  const missing = (what: string, needs: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs });
  const metrics: PackMetric[] = [
    { key: 'programmes', label: 'Programmes in the pipeline', unit: 'COUNT', formula: 'Rows of the pipeline schedule', sourceCount: pipeline.length, ...(pipeline.length ? { value: String(pipeline.length) } : missing('pipeline schedule', ['PHARMA_PIPELINE'])) },
    {
      key: 'programmes_registered',
      label: 'Programmes with a registered trial',
      unit: 'COUNT',
      formula: 'Pipeline programmes with at least one trial-registry record',
      sourceCount: trials.length,
      ...(pipeline.length && trials.length ? { value: String(registered.length) } : missing('pipeline schedule and the trial-registry records', ['PHARMA_PIPELINE', 'PHARMA_TRIAL_REGISTRY'])),
    },
    { key: 'patent_families', label: 'Patent families', unit: 'COUNT', formula: 'Distinct families in the patent schedule', sourceCount: patents.length, ...(families.size ? { value: String(families.size) } : missing('patent schedule', ['PHARMA_PATENTS'])) },
    {
      key: 'model_milestones',
      label: 'Milestones in the seller’s model',
      unit: 'MONEY',
      formula: 'Sum of the milestone amounts in the obligations model (the agreements are checked against it on the Pipeline tab)',
      sourceCount: milestones.length,
      ...(milestones.length ? { value: milestones.reduce((total, row) => total.plus(row.amount ?? 0), new D(0)).toFixed(2) } : missing('payment obligations model', ['PHARMA_OBLIGATIONS'])),
    },
    {
      key: 'trailing_revenue',
      label: 'Trailing twelve months’ billed revenue',
      unit: 'MONEY',
      formula: 'Billing lines in the twelve months to the latest billed month',
      sourceCount: trailing?.rows ?? 0,
      ...(trailing && trailing.rows ? { value: trailing.amount.toFixed(2) } : missing('billing export', ['BILLING_INVOICE_LINE'])),
    },
    {
      key: 'rd_latest_year',
      label: year ? `R&D spend (${year.year})` : 'R&D spend, latest year',
      unit: 'MONEY',
      formula: 'The imported P&L lines naming research and development, latest fiscal year',
      sourceCount: rd?.evidenceIds.length ?? 0,
      ...(rd && new D(rd.amount).gt(0) ? { value: rd.amount } : missing('P&L by year', ['FINANCIAL_PNL'])),
    },
    {
      key: 'rd_share_latest_year',
      label: year ? `R&D as a share of revenue (${year.year})` : 'R&D as a share of revenue',
      unit: 'RATIO',
      formula: 'R&D ÷ revenue, latest imported fiscal year',
      sourceCount: rd?.evidenceIds.length ?? 0,
      ...(rd?.ratio && new D(rd.amount).gt(0) ? { value: rd.ratio } : missing('P&L by year', ['FINANCIAL_PNL'])),
    },
  ];
  return { calculator: 'pharma-pipeline', version: PHARMA_PIPELINE_VERSION, currency: input.currency, metrics };
}

export const PHARMA_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'pharma-pipeline',
  version: PHARMA_PIPELINE_VERSION,
  evidenceTypes: [PROGRAMME, REGISTRY_TRIAL, PATENT, OBLIGATION, SCIENTIST, INVOICE_LINE, 'finance.pnl_line'],
  compute: pharmaMetrics,
};
