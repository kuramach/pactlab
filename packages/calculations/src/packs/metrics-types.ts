import type { PackRuleEvidence } from './rule-types';

/**
 * What every non-SaaS pack calculator returns (T-059): a list of figures, each
 * with its formula and how many source records it rests on. Values are
 * decimal strings; money is in the report's currency (the deal's base
 * currency). The SaaS engine keeps its own richer report.
 */
export interface PackMetric {
  readonly key: string;
  readonly label: string;
  readonly unit: 'MONEY' | 'RATIO' | 'COUNT';
  /** Null when the inputs needed are missing; `unavailableReason` says which. */
  readonly value: string | null;
  readonly formula: string;
  readonly sourceCount: number;
  readonly unavailableReason?: string;
}

export interface PackMetricsReport {
  readonly calculator: string;
  readonly version: string;
  readonly currency: string;
  readonly metrics: readonly PackMetric[];
}

export interface PackMetricsInput {
  readonly currency: string;
  readonly evidence: readonly PackRuleEvidence[];
}
