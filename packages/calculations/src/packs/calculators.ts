import { computeSaasMetrics, prepareWorkspace, type MetricsInput } from '../metrics/metrics';
import { METRICS_ENGINE_VERSION } from '../metrics/types';

/**
 * Metric calculators, one per pack family (ADR 0009). Deterministic,
 * decimal-only and versioned; each names the evidence types it reads. The
 * SaaS engine is the software pack's calculator and every pack's until its
 * own ships (T-058+). The first non-revenue calculator (multifamily, T-059)
 * decides how the metrics API serves more than one.
 */
export interface MetricCalculator<Input, Report> {
  readonly id: string;
  readonly version: string;
  readonly evidenceTypes: readonly string[];
  readonly compute: (input: Input) => Report;
}

export const SAAS_METRICS_CALCULATOR: MetricCalculator<MetricsInput, ReturnType<typeof computeSaasMetrics>> = {
  id: 'saas-metrics',
  version: METRICS_ENGINE_VERSION,
  evidenceTypes: ['billing.invoice_line', 'fx.rate', 'management.kpi'],
  compute: (input) => computeSaasMetrics(input, prepareWorkspace(input)),
};

export const METRIC_CALCULATORS: Readonly<Record<string, MetricCalculator<never, unknown>>> = {
  [SAAS_METRICS_CALCULATOR.id]: SAAS_METRICS_CALCULATOR as MetricCalculator<never, unknown>,
};
