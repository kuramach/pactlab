import { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import { INVOICE_LINE, monthName } from '../common';
import { capexSchedule, CAPEX_ITEM } from '../commercial-property/leases';
import { packHistory, withHistory } from '../history';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE } from '../pnl-trend';
import { benchmarkYear, HOTEL_BENCHMARK, HOTEL_OPERATING, HOTELS_PERFORMANCE_VERSION, hotelFeeYears, operatingYear, statementSeasonality } from './performance';
import { HOTELS_HISTORY } from './rules';

type Decimal = InstanceType<typeof D>;
const ratio = (value: Decimal) => value.toFixed(4);
const cash = (value: Decimal) => value.toFixed(2);
const index = (value: Decimal) => value.toFixed(1);
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const calendarMonth = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;

/**
 * The hotels pack's figures (T-166): from the operating history, the trailing twelve months' occupancy, ADR, RevPAR
 * and GOP margin (with every year read beside the P&L); from the STR benchmark, the RevPAR, occupancy and ADR indices
 * against the competitive set; from the imported P&L, franchise and brand fees ÷ rooms revenue in the latest fiscal
 * year, and seasonality where the statements are imported by month; from the seller's capex schedule, the capex it
 * carries. The agreements and the PIP are documents: the rules read them. It never values the hotel or its flag.
 */
export function hotelsMetrics(input: PackMetricsInput): PackMetricsReport {
  const operating = operatingYear(input.evidence);
  const benchmark = benchmarkYear(input.evidence);
  const fees = hotelFeeYears(input.evidence).at(-1) ?? null;
  const seasonality = statementSeasonality(input.evidence);
  const schedule = capexSchedule(input.evidence);
  const needs = (what: string, targets: readonly string[]) => ({ value: null, unavailableReason: `Import the ${what}.`, needs: targets });
  const needOperating = needs('operating history (twelve consecutive months)', ['HOTELS_OPERATING_HISTORY']);
  const needBenchmark = needs('STR benchmark (twelve consecutive months)', ['HOTELS_STR_BENCHMARK']);
  const window = (period: { from: string; to: string } | null) => (period ? ` (${monthName(period.from)} to ${monthName(period.to)})` : '');
  const metrics: PackMetric[] = [
    { key: 'occupancy', label: `Occupancy, trailing twelve months${window(operating)}`, unit: 'RATIO', formula: 'Σ rooms sold ÷ Σ rooms available, operating history', sourceCount: operating?.evidenceIds.length ?? 0, ...(operating?.occupancy ? { value: ratio(operating.occupancy) } : needOperating) },
    { key: 'adr', label: `Average daily rate (ADR)${window(operating)}`, unit: 'MONEY', formula: 'Σ room revenue ÷ Σ rooms sold, operating history', sourceCount: operating?.evidenceIds.length ?? 0, ...(operating?.adr ? { value: cash(operating.adr) } : needOperating) },
    { key: 'revpar', label: `RevPAR${window(operating)}`, unit: 'MONEY', formula: 'Σ room revenue ÷ Σ rooms available, operating history', sourceCount: operating?.evidenceIds.length ?? 0, ...(operating?.revpar ? { value: cash(operating.revpar) } : needOperating) },
    {
      key: 'gop_margin',
      label: `GOP margin${window(operating)}`,
      unit: 'RATIO',
      formula: 'Σ gross operating profit ÷ Σ (room revenue + food and beverage revenue), operating history',
      sourceCount: operating?.evidenceIds.length ?? 0,
      ...(operating?.gopMargin ? { value: ratio(operating.gopMargin) } : needs('operating history with gross operating profit for every month', ['HOTELS_OPERATING_HISTORY'])),
    },
    {
      key: 'revpar_index',
      label: `RevPAR index against the competitive set${window(benchmark)}`,
      unit: 'COUNT',
      formula: 'Σ the hotel’s RevPAR ÷ Σ the competitive set’s RevPAR × 100, STR benchmark (100 = fair share)',
      sourceCount: benchmark?.evidenceIds.length ?? 0,
      ...(benchmark?.revparIndex ? { value: index(benchmark.revparIndex) } : needBenchmark),
    },
    {
      key: 'occupancy_index',
      label: `Occupancy index (MPI)${window(benchmark)}`,
      unit: 'COUNT',
      formula: 'Σ the hotel’s occupancy ÷ Σ the competitive set’s × 100, STR benchmark',
      sourceCount: benchmark?.evidenceIds.length ?? 0,
      ...(benchmark?.occupancyIndex ? { value: index(benchmark.occupancyIndex) } : needs('STR benchmark with the competitive set’s occupancy', ['HOTELS_STR_BENCHMARK'])),
    },
    {
      key: 'adr_index',
      label: `ADR index (ARI)${window(benchmark)}`,
      unit: 'COUNT',
      formula: 'Σ the hotel’s ADR ÷ Σ the competitive set’s × 100, STR benchmark',
      sourceCount: benchmark?.evidenceIds.length ?? 0,
      ...(benchmark?.adrIndex ? { value: index(benchmark.adrIndex) } : needs('STR benchmark with the competitive set’s ADR', ['HOTELS_STR_BENCHMARK'])),
    },
    {
      key: 'brand_fees_share',
      label: fees ? `Franchise and brand fees ÷ rooms revenue (FY${fees.year})` : 'Franchise and brand fees ÷ rooms revenue',
      unit: 'RATIO',
      formula: 'Σ royalty, marketing, reservation and loyalty fee lines ÷ Σ rooms revenue lines, latest fiscal year of the imported P&L',
      sourceCount: fees?.evidenceIds.length ?? 0,
      ...(fees ? { value: ratio(fees.share) } : needs('P&L with rooms revenue and the franchise and brand fee lines', ['FINANCIAL_PNL'])),
    },
    {
      key: 'statement_seasonality',
      label: seasonality ? `Seasonality from the monthly statements: ${seasonality.peak.map(calendarMonth).join(' and ')} against ${calendarMonth(seasonality.trough)}` : 'Seasonality from the monthly statements',
      unit: 'COUNT',
      formula: 'The two strongest months’ rooms revenue, averaged, ÷ the weakest month’s, over the latest twelve months of the P&L by month',
      sourceCount: seasonality?.evidenceIds.length ?? 0,
      ...(seasonality ? { value: seasonality.ratio.toFixed(2) } : needs('P&L by month (twelve consecutive months) to show seasonality from the statements', ['FINANCIAL_PNL'])),
    },
    {
      key: 'scheduled_capex',
      label: 'Capex on the seller’s schedule, every line',
      unit: 'MONEY',
      formula: 'Σ capex schedule lines, planned and committed (the PIP check matches each PIP item against them)',
      sourceCount: schedule.length,
      ...(schedule.length ? { value: cash(schedule.reduce((total, line) => total.plus(line.amount), new D(0))) } : needs('seller’s capex schedule', ['CRE_CAPEX_SCHEDULE'])),
    },
  ];
  // The years side by side (ADR 0057): the P&L by year beside occupancy, ADR and RevPAR; occupancy and ADR carry a History strip.
  const history = packHistory(HOTELS_HISTORY, input.evidence, input);
  return {
    calculator: 'hotels-performance',
    version: HOTELS_PERFORMANCE_VERSION,
    currency: input.currency,
    metrics: metrics.map((metric) => (metric.key === 'occupancy' || metric.key === 'adr' || metric.key === 'revpar' ? withHistory(metric, history, metric.key) : metric)),
    history: history.table,
  };
}

export const HOTELS_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'hotels-performance',
  version: HOTELS_PERFORMANCE_VERSION,
  evidenceTypes: [HOTEL_OPERATING, HOTEL_BENCHMARK, CAPEX_ITEM, INVOICE_LINE, PNL_LINE],
  compute: hotelsMetrics,
};
