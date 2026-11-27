import { D } from '../../metrics/decimal';
import type { MetricCalculator } from '../calculators';
import { packHistory, withHistory } from '../history';
import type { PackMetric, PackMetricsInput, PackMetricsReport } from '../metrics-types';
import { PNL_LINE } from '../pnl-trend';
import { MUSIC_HISTORY } from './history';
import { catalogRows, incomeModel, MUSIC_DEFAULT_HOLD_YEARS, MUSIC_EVIDENCE_TYPES, terminationExposure } from './catalog';

export const MUSIC_METRICS_VERSION = 'music-royalties-1';

const cash = (value: InstanceType<typeof D>) => value.toFixed(2);
const ratio = (value: InstanceType<typeof D>) => value.toFixed(4);
const SOURCES = [
  ['performance', 'Performance'],
  ['mechanical', 'Mechanical'],
  ['streaming', 'Streaming'],
  ['sync', 'Sync'],
  ['neighbouring', 'Neighbouring rights'],
] as const;

/** The royalty income model (T-140) as labelled figures: trailing, prior, decay-adjusted, by source, concentration and termination exposure. */
export function musicMetrics(input: PackMetricsInput): PackMetricsReport {
  const rows = catalogRows(input.evidence);
  const income = incomeModel(rows);
  const exposure = terminationExposure(rows, income, MUSIC_DEFAULT_HOLD_YEARS);
  const noStatements = { value: null, unavailableReason: 'Import the royalty statements.' };
  const trailingLines = [...income.byWork.values()].reduce((count, work) => count + work.lineIds.length, 0);
  const [top] = [...income.byWork.values()].sort((a, b) => b.trailing.comparedTo(a.trailing));
  const metrics: PackMetric[] = [
    { key: 'works', label: 'Works in the register', unit: 'COUNT', formula: 'Works and recordings in the works register', sourceCount: rows.works.length, ...(rows.works.length ? { value: String(rows.works.length) } : { value: null, unavailableReason: 'Import the works register.' }) },
    { key: 'trailing_income', label: 'Trailing net income', unit: 'MONEY', formula: `Σ statement lines in the twelve months to ${income.latestPeriodEnd ?? 'the latest period'}`, sourceCount: trailingLines, ...(income.latestPeriodEnd ? { value: cash(income.trailing) } : noStatements) },
    { key: 'prior_income', label: 'Prior-year net income', unit: 'MONEY', formula: 'Σ statement lines in the twelve months before that', sourceCount: rows.lines.length - trailingLines, ...(income.latestPeriodEnd ? { value: cash(income.prior) } : noStatements) },
    {
      key: 'income_change',
      label: 'Year-on-year change',
      unit: 'RATIO',
      formula: 'Trailing ÷ prior-year income − 1',
      sourceCount: rows.lines.length,
      ...(income.prior.gt(0) ? { value: ratio(income.trailing.div(income.prior).minus(1)) } : { value: null, unavailableReason: 'Needs a prior year of statements.' }),
    },
    { key: 'decay_adjusted_income', label: 'Decay-adjusted income', unit: 'MONEY', formula: 'Σ by catalog-age band: trailing income × (1 + the band’s year-on-year decline); growth is never added', sourceCount: trailingLines, ...(income.latestPeriodEnd ? { value: cash(income.decayAdjusted) } : noStatements) },
    ...SOURCES.map(([source, label]): PackMetric => ({
      key: `income_${source}`,
      label: `${label} income (trailing)`,
      unit: 'MONEY',
      formula: `Σ trailing statement lines with income source ${source}`,
      sourceCount: trailingLines,
      ...(income.latestPeriodEnd ? { value: cash(income.bySource.get(source) ?? new D(0)) } : noStatements),
    })),
    {
      key: 'top_work_share',
      label: 'Top work’s share',
      unit: 'RATIO',
      formula: 'Largest work’s trailing income ÷ trailing income',
      sourceCount: top?.lineIds.length ?? 0,
      ...(top && income.trailing.gt(0) ? { value: ratio(top.trailing.div(income.trailing)) } : noStatements),
    },
    {
      key: 'termination_exposed_share',
      label: `Income terminable within ${MUSIC_DEFAULT_HOLD_YEARS} years`,
      unit: 'RATIO',
      formula: `Trailing income behind US grants whose §203/§304(c) window is open within ${MUSIC_DEFAULT_HOLD_YEARS} years of the latest period ÷ trailing income`,
      sourceCount: exposure.grants.length,
      ...(exposure.share ? { value: ratio(exposure.share) } : { value: null, unavailableReason: 'Import the royalty statements, works register and chain of title.' }),
    },
    { key: 'statement_periods', label: 'Statement periods', unit: 'COUNT', formula: 'Distinct statement period ends', sourceCount: rows.lines.length, value: String(income.periods.length) },
  ];
  // Five years (T-184b): statement income by year beside any imported P&L; trailing_income carries a History strip.
  const history = packHistory(MUSIC_HISTORY, input.evidence, input);
  return {
    calculator: 'music-royalties',
    version: MUSIC_METRICS_VERSION,
    currency: input.currency,
    metrics: metrics.map((metric) => (metric.key === 'trailing_income' ? withHistory(metric, history, 'income') : metric)),
    history: history.table,
  };
}

export const MUSIC_METRICS_CALCULATOR: MetricCalculator<PackMetricsInput, PackMetricsReport> = {
  id: 'music-royalties',
  version: MUSIC_METRICS_VERSION,
  evidenceTypes: [...MUSIC_EVIDENCE_TYPES, PNL_LINE],
  compute: musicMetrics,
};
