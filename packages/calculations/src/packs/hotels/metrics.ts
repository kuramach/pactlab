import { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import { monthName } from '../common';
import { wholeMonths } from '../clinics/practice';
import { packHistory, withHistory } from '../history';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE } from '../pnl-trend';
import {
  brandFeeYears,
  HOTEL_AGREEMENT,
  HOTEL_BENCHMARK,
  HOTEL_CAPEX_BUDGET,
  HOTEL_OPERATING,
  HOTEL_PIP_ITEM,
  hotelAgreements,
  hotelsAnalysisDate,
  HOTELS_PERFORMANCE_VERSION,
  nearTermUnbudgeted,
  operatingWindow,
  pipItems,
  revparIndexWindow,
  seasonality,
} from './performance';
import { HOTELS_HISTORY } from './rules';

type Decimal = InstanceType<typeof D>;
const ratio = (value: Decimal) => value.toFixed(4);
const cash = (value: Decimal) => value.toFixed(2);
const count = (value: number) => String(value);

/**
 * The hotels pack's figures (T-166): occupancy, ADR and RevPAR over the trailing twelve months of the operating
 * history (with five years of history beside the P&L), the RevPAR index from the STR benchmark, monthly
 * seasonality, the franchise and management agreements' term left at the analysis date, the PIP's total and what
 * of it falls due within a year unbudgeted, and the latest year's brand fees ÷ rooms revenue. Documents can move
 * a date or the closing: the rules read them; these figures read the registers as imported.
 */
export function hotelsMetrics(input: PackMetricsInput): PackMetricsReport {
  const needs = (what: string, targets: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs: targets });
  const operating = operatingWindow(input.evidence);
  const complete = operating && operating.missing.length === 0 ? operating : null;
  const needOperating = needs('operating history by month (twelve complete months)', ['HOTELS_OPERATING_HISTORY']);
  const period = complete ? `the twelve months to ${monthName(complete.to)}` : 'the trailing twelve months';
  const benchmark = revparIndexWindow(input.evidence);
  const index = benchmark && benchmark.missing.length === 0 ? benchmark : null;
  const season = seasonality(input.evidence);
  const asOf = hotelsAnalysisDate(input.evidence);
  const agreements = hotelAgreements(input.evidence);
  const termLeft = (kind: 'FRANCHISE' | 'MANAGEMENT', key: string, label: string): PackMetric => {
    const agreement = agreements.find((entry) => entry.kind === kind) ?? null;
    return {
      key,
      label: agreement ? `${label} (${agreement.counterparty})` : label,
      unit: 'COUNT',
      formula: `Whole months from the end of the latest month in the exports to the ${kind === 'FRANCHISE' ? 'franchise' : 'management'} agreement’s expiry, from the register (the rules measure from the expected closing, the agreement’s own date governing)`,
      sourceCount: agreement ? 1 : 0,
      ...(agreement?.expiresOn && asOf
        ? { value: count(agreement.expiresOn < asOf ? 0 : wholeMonths(asOf, agreement.expiresOn)) }
        : needs('agreements register with the agreement’s expiry, and the operating history', ['HOTELS_AGREEMENTS', 'HOTELS_OPERATING_HISTORY'])),
    };
  };
  const items = pipItems(input.evidence);
  const pipTotal = items.length ? items.reduce((total, item) => total.plus(item.cost), new D(0)) : null;
  const dueSoon = asOf && items.length ? nearTermUnbudgeted(items, asOf) : [];
  const fees = brandFeeYears(input.evidence).at(-1) ?? null;
  const metrics: PackMetric[] = [
    { key: 'occupancy', label: 'Occupancy, trailing', unit: 'RATIO', formula: `Σ rooms sold ÷ Σ rooms available over ${period}`, sourceCount: complete?.rows.length ?? 0, ...(complete?.occupancy ? { value: ratio(complete.occupancy) } : needOperating) },
    { key: 'adr', label: 'Average daily rate, trailing', unit: 'MONEY', formula: `Σ room revenue ÷ Σ rooms sold over ${period}`, sourceCount: complete?.rows.length ?? 0, ...(complete?.adr ? { value: cash(complete.adr) } : needOperating) },
    { key: 'revpar', label: 'RevPAR, trailing', unit: 'MONEY', formula: `Σ room revenue ÷ Σ rooms available over ${period}`, sourceCount: complete?.rows.length ?? 0, ...(complete?.revpar ? { value: cash(complete.revpar) } : needOperating) },
    {
      key: 'revpar_index',
      label: 'RevPAR index against the comp set (1.00 = fair share)',
      unit: 'RATIO',
      formula: `Σ the hotel’s RevPAR ÷ Σ the competitive set’s RevPAR over ${index ? `the twelve months to ${monthName(index.to)}` : 'the trailing twelve months'}, from the STR benchmark`,
      sourceCount: index?.rows.length ?? 0,
      ...(index?.index ? { value: ratio(index.index.div(100)) } : needs('STR benchmark by month (twelve complete months)', ['HOTELS_STR_BENCHMARK'])),
    },
    {
      key: 'seasonality',
      label: season ? `Weakest month ÷ strongest month (${monthName(season.trough.canonical['month'] ?? '')} ÷ ${monthName(season.peak.canonical['month'] ?? '')})` : 'Weakest month ÷ strongest month',
      unit: 'RATIO',
      formula: 'Room revenue in the weakest month ÷ the strongest month of the trailing twelve, from the monthly operating history',
      sourceCount: complete?.rows.length ?? 0,
      ...(season ? { value: ratio(season.share) } : needOperating),
    },
    termLeft('FRANCHISE', 'franchise_months_left', 'Franchise term left, months'),
    termLeft('MANAGEMENT', 'management_months_left', 'Management agreement term left, months'),
    {
      key: 'pip_total',
      label: 'PIP total',
      unit: 'MONEY',
      formula: 'Σ the estimated cost of every item in the PIP schedule',
      sourceCount: items.length,
      ...(pipTotal ? { value: cash(pipTotal) } : needs('property improvement plan (PIP) items', ['HOTELS_PIP_SCHEDULE'])),
    },
    {
      key: 'pip_due_unbudgeted',
      label: 'PIP due within a year and unbudgeted',
      unit: 'MONEY',
      formula: 'Σ (cost − budget lines naming the item) for PIP items due within twelve months of the analysis date (the rules measure from the expected closing)',
      sourceCount: dueSoon.length,
      ...(items.length && asOf && input.evidence.some((row) => row.evidenceType === HOTEL_CAPEX_BUDGET)
        ? { value: cash(dueSoon.reduce((total, item) => total.plus(item.unbudgeted), new D(0))) }
        : needs('PIP items and the capital expenditure budget', ['HOTELS_PIP_SCHEDULE', 'HOTELS_CAPEX_BUDGET'])),
    },
    {
      key: 'brand_fee_ratio',
      label: fees ? `Brand fees ÷ rooms revenue (FY${fees.year})` : 'Brand fees ÷ rooms revenue',
      unit: 'RATIO',
      formula: 'Franchise, royalty, marketing and reservation fee lines ÷ the rooms revenue line, latest imported P&L year',
      sourceCount: fees ? fees.feeIds.length + fees.roomsIds.length : 0,
      ...(fees?.ratio ? { value: ratio(fees.ratio) } : needs('P&L by year with rooms revenue and the brand fee lines', ['FINANCIAL_PNL'])),
    },
  ];
  // Five years: the P&L, occupancy, ADR and RevPAR by year; RevPAR carries a History strip.
  const history = packHistory(HOTELS_HISTORY, input.evidence, input);
  return {
    calculator: 'hotels-performance',
    version: HOTELS_PERFORMANCE_VERSION,
    currency: input.currency,
    metrics: metrics.map((metric) => (metric.key === 'revpar' ? withHistory(metric, history, 'revpar') : metric)),
    history: history.table,
  };
}

export const HOTELS_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'hotels-performance',
  version: HOTELS_PERFORMANCE_VERSION,
  evidenceTypes: [HOTEL_OPERATING, HOTEL_BENCHMARK, HOTEL_AGREEMENT, HOTEL_PIP_ITEM, HOTEL_CAPEX_BUDGET, PNL_LINE],
  compute: hotelsMetrics,
};
