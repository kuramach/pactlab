import { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import { INVOICE_LINE, amountOf } from '../common';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { billedMrr, capTableOf } from '../venture/rules';
import { SPV_CAP_TABLE, SPV_FINANCIALS } from './rules';

export const SPV_METRICS_VERSION = 'spv-round-1';

/** The startup's round inputs as labelled figures: shares, the SAFE and note stack, billed ARR, cash and runway (T-141). */
export function spvMetrics(input: PackMetricsInput): PackMetricsReport {
  const cap = capTableOf(input.evidence);
  const capRows = input.evidence.filter((row) => row.evidenceType === SPV_CAP_TABLE);
  const held = cap.filter((row) => row.instrument !== 'safe' && row.instrument !== 'note');
  const converting = cap.filter((row) => row.instrument === 'safe' || row.instrument === 'note');
  const billed = billedMrr(input.evidence);
  const months = input.evidence.filter((row) => row.evidenceType === SPV_FINANCIALS && /^\d{4}-\d{2}$/.test(row.canonical['month'] ?? '')).sort((a, b) => (a.canonical['month'] ?? '').localeCompare(b.canonical['month'] ?? ''));
  const recent = months.slice(-3);
  const burn = recent.length ? recent.reduce((sum, row) => sum.plus(amountOf(row, 'net_burn')), new D(0)).div(recent.length) : null;
  const cash = months.at(-1) ? amountOf(months.at(-1) as never, 'cash_balance') : null;
  const noCap = { value: null, unavailableReason: 'Import the cap table.' };
  const metrics: PackMetric[] = [
    { key: 'pre_round_shares', label: 'Pre-round shares outstanding', unit: 'COUNT', formula: 'Σ shares and options in the cap table, including the unallocated pool (SAFEs and notes excluded)', sourceCount: held.length, ...(held.length ? { value: held.reduce((sum, row) => sum.plus(row.shares ?? 0), new D(0)).toFixed(0) } : noCap) },
    { key: 'converting_instruments', label: 'SAFEs and notes', unit: 'COUNT', formula: 'Converting instruments in the cap table', sourceCount: converting.length, ...(capRows.length ? { value: String(converting.length) } : noCap) },
    { key: 'converting_principal', label: 'SAFE and note principal', unit: 'MONEY', formula: 'Σ principal of the SAFEs and notes', sourceCount: converting.length, ...(capRows.length ? { value: converting.reduce((sum, row) => sum.plus(row.principal ?? 0), new D(0)).toFixed(2) } : noCap) },
    { key: 'billed_arr', label: 'Billed ARR', unit: 'MONEY', formula: 'Latest month’s billing, each line normalized to a month, × 12', sourceCount: billed?.lines.length ?? 0, ...(billed ? { value: billed.mrr.times(12).toFixed(2) } : { value: null, unavailableReason: 'Import the startup’s billing.' }) },
    { key: 'cash', label: 'Cash (latest month)', unit: 'MONEY', formula: 'Cash balance in the latest month of the monthly financials', sourceCount: months.length ? 1 : 0, ...(cash ? { value: cash.toFixed(2) } : { value: null, unavailableReason: 'Import the monthly financials.' }) },
    {
      key: 'runway_months',
      label: 'Runway (months)',
      unit: 'COUNT',
      formula: 'Latest cash ÷ average net burn over the last three months',
      sourceCount: recent.length,
      ...(cash && burn && burn.gt(0) && recent.length === 3 ? { value: cash.div(burn).toFixed(1) } : { value: null, unavailableReason: 'Needs three months of cash and net burn.' }),
    },
  ];
  return { calculator: 'spv-round', version: SPV_METRICS_VERSION, currency: input.currency, metrics };
}

export const SPV_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'spv-round',
  version: SPV_METRICS_VERSION,
  evidenceTypes: [INVOICE_LINE, SPV_CAP_TABLE, SPV_FINANCIALS],
  compute: spvMetrics,
};
