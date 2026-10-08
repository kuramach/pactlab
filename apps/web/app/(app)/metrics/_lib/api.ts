import { apiGet, apiPost } from '../../deals/_lib/api';

export { apiPost };

/** Response shapes of /v1/deals/:dealId/metrics/* (deterministic engine output). */
export interface MoneyValue {
  amount: string;
  currency: string;
}

export interface SourceRef {
  evidenceId: string;
  sourceRecordId: string;
  citationId: string | null;
}

export interface MetricView {
  key: string;
  label: string;
  unit: 'MONEY' | 'RATIO' | 'COUNT';
  value: string | null;
  currency: string | null;
  formula: string;
  timeBasis: string;
  inclusionPolicy: string;
  inputs: SourceRef[];
  unavailableReason: string | null;
}

export interface ExclusionView {
  ref: SourceRef;
  reason: string;
  detail: string;
  customerId: string | null;
  month: string | null;
  monthlyAmount: MoneyValue | null;
}

export interface MetricsSummaryView {
  report: {
    engineVersion: string;
    asOfMonth: string;
    baseCurrency: string;
    coverageStart: string | null;
    inclusionPolicy: string;
    metrics: MetricView[];
    bridge: {
      fromMonth: string;
      toMonth: string;
      opening: MoneyValue;
      newMrr: MoneyValue;
      expansion: MoneyValue;
      contraction: MoneyValue;
      churned: MoneyValue;
      reactivation: MoneyValue;
      closing: MoneyValue;
    } | null;
    series: { month: string; mrr: MoneyValue; arr: MoneyValue; activeCustomers: number }[];
    customers: {
      customerId: string;
      customerName: string | null;
      arr: MoneyValue;
      share: string | null;
      contributions: {
        ref: SourceRef;
        original: MoneyValue;
        converted: MoneyValue;
        fx: { rate: string; rateDate: string; source: string } | null;
      }[];
    }[];
    exclusions: ExclusionView[];
  };
  reconciliation: {
    reconciliationId: string;
    asOfMonth: string;
    status: string;
    tolerance: string;
    reported: {
      ref: SourceRef;
      period: string | null;
      original: MoneyValue | null;
      value: MoneyValue | null;
      fx: { rate: string; rateDate: string; source: string } | null;
    } | null;
    calculated: MoneyValue;
    delta: MoneyValue | null;
    deltaRatio: string | null;
    explanation: {
      reason: string;
      lines: number;
      basis: 'ANNUALIZED_MRR' | 'BILLED_AMOUNT';
      amount: MoneyValue;
      unconvertedLines: number;
      refs: SourceRef[];
    }[];
  };
  draftFinding: {
    severity: string;
    title: string;
    summary: string;
    generatedBy: string;
    evidence: { evidenceId: string; citationId: string; sourceRecordId: string; claim: string }[];
    omittedCitations: number;
  } | null;
  draftFindingRecorded: boolean;
  approval: {
    status: 'PENDING' | 'APPROVED' | 'STALE' | 'NOT_REQUIRED';
    reconciliationId: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
    note: string | null;
  };
}

export interface CohortsView {
  formula: string;
  rows: {
    cohort: string;
    openingBalance: boolean;
    customers: number;
    startingMrr: MoneyValue;
    cells: { offset: number; month: string; revenueRetention: string | null }[];
  }[];
}

const base = (dealId: string) => `/v1/deals/${encodeURIComponent(dealId)}/metrics`;
const query = (asOf: string | undefined) => (asOf ? `?asOf=${encodeURIComponent(asOf)}` : '');

export const metricsApi = {
  summary: (dealId: string, asOf?: string) =>
    apiGet<MetricsSummaryView>(`${base(dealId)}/summary${query(asOf)}`),
  cohorts: (dealId: string, asOf?: string) =>
    apiGet<CohortsView>(`${base(dealId)}/cohorts${query(asOf)}`),
  reconcile: (dealId: string, asOf: string) =>
    apiPost<MetricsSummaryView>(`${base(dealId)}/reconcile`, { asOf }),
  approve: (dealId: string, reconciliationId: string, asOf: string, note: string) =>
    apiPost<MetricsSummaryView>(
      `${base(dealId)}/reconcile/${encodeURIComponent(reconciliationId)}/approve`,
      { asOf, note },
    ),
};
