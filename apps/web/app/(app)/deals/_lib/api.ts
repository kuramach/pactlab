import type {
  BillingSystemView,
  DealPartiesResponse,
  DealSummary,
  ImportMappingBody,
  ImportPreviewView,
  ImportResultView,
  SourcePlanResponse,
  SourceUploadView,
  StartPactCommand,
  UploadDetailView,
} from '@pactlab/contracts';
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
  baseCurrency?: string;
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

export type SendResult<T> = ApiResult<T> | { kind: 'conflict' } | { kind: 'invalid' } | { kind: 'unavailable' };

/** Server-side write; the browser never holds the token or calls the API directly. */
export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'PUT',
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<SendResult<T>> {
  const token = await organizationAccessToken();
  if (!token) return { kind: 'signed-out' };
  let response: Response;
  try {
    response = await fetch(new URL(path, publicEnv().NEXT_PUBLIC_API_ORIGIN), {
      method,
      headers: { ...headers, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
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
  if (response.status === 503) return { kind: 'unavailable' };
  return { kind: 'error' };
}

export function apiPost<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<SendResult<T>> {
  return apiSend<T>('POST', path, body, headers);
}

export type UploadFailure = 'too-large' | 'not-text' | 'unreadable' | 'scanner' | 'forbidden' | 'signed-out' | 'error';

/** Server-side raw CSV upload; the browser never holds the token or calls the API directly. */
export async function apiUploadCsv(
  path: string,
  body: Uint8Array<ArrayBuffer>,
): Promise<{ kind: 'ok'; data: UploadDetailView } | { kind: UploadFailure }> {
  const token = await organizationAccessToken();
  if (!token) return { kind: 'signed-out' };
  let response: Response;
  try {
    response = await fetch(new URL(path, publicEnv().NEXT_PUBLIC_API_ORIGIN), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'text/csv' },
      body,
      cache: 'no-store',
    });
  } catch {
    return { kind: 'error' };
  }
  if (response.ok) return { kind: 'ok', data: (await response.json()) as UploadDetailView };
  const failures: Record<number, UploadFailure> = {
    401: 'signed-out',
    403: 'forbidden',
    413: 'too-large',
    415: 'not-text',
    422: 'unreadable',
    503: 'scanner',
  };
  return { kind: failures[response.status] ?? 'error' };
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

export interface ValidationView {
  ok: boolean;
  checks: { name: 'reachability' | 'credentials' | 'scopes' | 'mappings'; status: 'PASS' | 'FAIL' | 'SKIPPED'; detail: string }[];
}

export type ConnectGitHubBody =
  | { method: 'APP'; repository: string }
  | { method: 'TOKEN'; repository: string; token: string };

export interface DealMember {
  id: string;
  userId: string;
  displayName: string;
  role: string;
  status: string;
}

export const dealsApi = {
  members: (dealId: string) => apiGet<{ items: DealMember[] }>(`/v1/deals/${encodeURIComponent(dealId)}/members`),
  organizationMembers: () =>
    apiGet<{ items: { userId: string; displayName: string; role: string }[] }>('/v1/organization/members'),
  addMember: (dealId: string, userId: string, role: string) =>
    apiPost<DealMember>(`/v1/deals/${encodeURIComponent(dealId)}/members`, { userId, role }),
  githubApp: () => apiGet<{ configured: boolean; installUrl: string | null }>('/v1/github/app'),
  connectGitHub: (dealId: string, body: ConnectGitHubBody) =>
    apiPost<{ connection: { id: string; displayName: string }; validation: ValidationView }>(
      `/v1/deals/${encodeURIComponent(dealId)}/connections/github`,
      body,
    ),
  requestSync: (dealId: string, connectionId: string, idempotencyKey: string) =>
    apiPost<{ id: string; status: string; recordsCreated: number; errorClass: string | null }>(
      `/v1/deals/${encodeURIComponent(dealId)}/sync-runs`,
      { connectionId },
      { 'idempotency-key': idempotencyKey },
    ),
  startPact: (command: StartPactCommand) => apiPost<DealSummary>('/v1/pacts', command),
  billingSystems: () => apiGet<{ items: BillingSystemView[] }>('/v1/billing-import/systems'),
  uploads: (dealId: string) => apiGet<{ items: SourceUploadView[] }>(`/v1/deals/${encodeURIComponent(dealId)}/uploads`),
  upload: (dealId: string, uploadId: string) =>
    apiGet<UploadDetailView>(`/v1/deals/${encodeURIComponent(dealId)}/uploads/${encodeURIComponent(uploadId)}`),
  uploadCsv: (dealId: string, system: string, fileName: string, body: Uint8Array<ArrayBuffer>) =>
    apiUploadCsv(
      `/v1/deals/${encodeURIComponent(dealId)}/uploads?${new URLSearchParams({ system, fileName }).toString()}`,
      body,
    ),
  previewImport: (dealId: string, uploadId: string, mapping: ImportMappingBody) =>
    apiPost<ImportPreviewView>(
      `/v1/deals/${encodeURIComponent(dealId)}/uploads/${encodeURIComponent(uploadId)}/preview`,
      { mapping },
    ),
  runImport: (dealId: string, uploadId: string, mapping: ImportMappingBody) =>
    apiPost<ImportResultView>(
      `/v1/deals/${encodeURIComponent(dealId)}/uploads/${encodeURIComponent(uploadId)}/import`,
      { mapping },
    ),
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
