import { organizationAccessToken } from '../../../../lib/auth0';
import { publicEnv } from '../../../../lib/env';
import { apiGet, type ApiResult } from '../../deals/_lib/api';

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

/** Server-side POST; the browser never holds the token or calls the API directly. */
export async function apiPost<T>(
  path: string,
  body: unknown,
): Promise<ApiResult<T> | { kind: 'conflict' } | { kind: 'invalid' }> {
  const token = await organizationAccessToken();
  if (!token) return { kind: 'signed-out' };
  let response: Response;
  try {
    response = await fetch(new URL(path, publicEnv().NEXT_PUBLIC_API_ORIGIN), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return { kind: 'error' };
  }
  if (response.ok) return { kind: 'ok', data: (await response.json()) as T };
  if (response.status === 400 || response.status === 422) return { kind: 'invalid' };
  if (response.status === 401) return { kind: 'signed-out' };
  if (response.status === 403) return { kind: 'forbidden' };
  if (response.status === 404) return { kind: 'not-found' };
  if (response.status === 409) return { kind: 'conflict' };
  return { kind: 'error' };
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
