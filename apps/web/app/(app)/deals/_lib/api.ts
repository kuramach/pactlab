import type { DealPartiesResponse, DealSummary, SourcePlanResponse, StartPactCommand } from '@pactlab/contracts';
import type { EvidenceItemView, EvidenceLineage } from '@pactlab/domain';
import { organizationAccessToken } from '../../../../lib/auth0';
import { publicEnv } from '../../../../lib/env';

export type ApiResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'signed-out' }
  | { kind: 'forbidden' }
  | { kind: 'not-found' }
  | { kind: 'error'; requestId?: string };

export interface DealListItem {
  id: string;
  name: string;
  targetName: string;
  transactionType: string;
  stage: string;
  status: string;
  parties?: DealSummary['parties'];
}

export interface EvidencePage {
  items: EvidenceItemView[];
  nextCursor: string | null;
  types: string[];
}

/** Server-side API call. The browser never holds the token or calls the API directly. */
export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const token = await organizationAccessToken();
  if (!token) return { kind: 'signed-out' };
  let response: Response;
  try {
    response = await fetch(new URL(path, publicEnv().NEXT_PUBLIC_API_ORIGIN), {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return { kind: 'error' };
  }
  if (response.ok) return { kind: 'ok', data: (await response.json()) as T };
  if (response.status === 401) return { kind: 'signed-out' };
  if (response.status === 403) return { kind: 'forbidden' };
  if (response.status === 404) return { kind: 'not-found' };
  const problem = (await response.json().catch(() => ({}))) as { requestId?: string };
  return { kind: 'error', ...(problem.requestId ? { requestId: problem.requestId } : {}) };
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

/** A connected source and what it last produced (`GET /v1/deals/:id/connections`). */
export interface DealSource {
  id: string;
  provider: string;
  displayName: string;
  mode: 'FIXTURE' | 'LIVE';
  status: string;
  evidenceVisibility: 'BUYER_ONLY' | 'SHARED';
  lastSyncRun: {
    id: string;
    status: string;
    connectorVersion: string;
    recordsSeen: number;
    recordsCreated: number;
    issuesCount: number;
    errorClass: string | null;
    completedAt: string | null;
  } | null;
  evidenceCount: number;
}

export const dealsApi = {
  startPact: (command: StartPactCommand) => apiPost<DealSummary>('/v1/pacts', command),
  parties: (dealId: string) => apiGet<DealPartiesResponse>(`/v1/deals/${encodeURIComponent(dealId)}/parties`),
  sourcePlan: (dealId: string) => apiGet<SourcePlanResponse>(`/v1/deals/${encodeURIComponent(dealId)}/source-plan`),
  sources: (dealId: string) => apiGet<{ items: DealSource[] }>(`/v1/deals/${encodeURIComponent(dealId)}/connections`),
  list: () => apiGet<{ items: DealListItem[] }>('/v1/deals'),
  get: (dealId: string) => apiGet<DealListItem>(`/v1/deals/${encodeURIComponent(dealId)}`),
  evidence: (dealId: string, query: string) =>
    apiGet<EvidencePage>(
      `/v1/deals/${encodeURIComponent(dealId)}/evidence${query ? `?${query}` : ''}`,
    ),
  lineage: (dealId: string, evidenceId: string) =>
    apiGet<EvidenceLineage>(
      `/v1/deals/${encodeURIComponent(dealId)}/evidence/${encodeURIComponent(evidenceId)}/lineage`,
    ),
};
