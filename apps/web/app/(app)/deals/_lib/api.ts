import type {
  AskingPriceView,
  ImportTargetView,
  BillingSystemView,
  DealPartiesResponse,
  DealSummary,
  ImportMappingBody,
  ImportPreviewView,
  ImportProgressView,
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
  /** Pre-Diligence, Diligence or Post-Close (derived from the stage). */
  phase: 'PRE' | 'DILIGENCE' | 'POST';
  status: string;
  baseCurrency?: string;
  /** BUYER: buyer-led diligence. SELLER: the seller runs a bid process (T-097). */
  initiatedBy?: 'BUYER' | 'SELLER';
  parties?: DealSummary['parties'];
  askingPrice?: DealSummary['askingPrice'];
}

export interface EvidencePage {
  items: EvidenceItemView[];
  nextCursor: string | null;
  /** Records matching the filters, across all pages. */
  total: number;
  /** Page size the API applied. */
  limit: number;
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

/** `invalid` may name the business rule the API refused on (a 422 `code`, e.g. DRAG_NEEDS_PRICE). */
export type SendResult<T> = ApiResult<T> | { kind: 'conflict' } | { kind: 'invalid'; code?: string } | { kind: 'unavailable'; code?: string };

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
  if (response.status === 422) {
    const code = ((await response.json().catch(() => null)) as { code?: unknown } | null)?.code;
    return typeof code === 'string' && /^[A-Z][A-Z_]{2,40}$/.test(code) ? { kind: 'invalid', code } : { kind: 'invalid' };
  }
  if (response.status === 400) return { kind: 'invalid' };
  if (response.status === 401) return { kind: 'signed-out' };
  if (response.status === 403) return { kind: 'forbidden' };
  if (response.status === 404) return { kind: 'not-found' };
  if (response.status === 409) return { kind: 'conflict' };
  if (response.status === 503) {
    // A stable reason (e.g. AI_ACCESS: the environment's AWS sign-in expired), never provider text.
    const code = ((await response.json().catch(() => null)) as { code?: unknown } | null)?.code;
    return typeof code === 'string' && /^[A-Z][A-Z_]{2,40}$/.test(code) ? { kind: 'unavailable', code } : { kind: 'unavailable' };
  }
  return { kind: 'error' };
}

export function apiPost<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<SendResult<T>> {
  return apiSend<T>('POST', path, body, headers);
}

export type UploadFailure = 'too-large' | 'too-many-rows' | 'not-text' | 'legacy-excel' | 'macros' | 'unreadable' | 'scanner' | 'forbidden' | 'signed-out' | 'error';

/** Server-side raw file upload (CSV, TSV or Excel); the browser never holds the token or calls the API directly. */
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
      // The API reads the format from the bytes and file name, not this header.
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body,
      cache: 'no-store',
    });
  } catch {
    return { kind: 'error' };
  }
  if (response.ok) return { kind: 'ok', data: (await response.json()) as UploadDetailView };
  const code = ((await response.json().catch(() => null)) as { code?: string } | null)?.code;
  const byCode: Record<string, UploadFailure> = { LEGACY_EXCEL: 'legacy-excel', MACROS: 'macros', NOT_TEXT: 'not-text', TOO_MANY_ROWS: 'too-many-rows' };
  if (code && byCode[code]) return { kind: byCode[code] };
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
  askingPrice: (dealId: string) =>
    apiGet<{ current: AskingPriceView | null; history: AskingPriceView[] }>(`/v1/deals/${encodeURIComponent(dealId)}/asking-price`),
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
  /** CSV import targets the deal's pack offers (billing first), with template headers. */
  importTargets: (dealId: string) => apiGet<{ items: ImportTargetView[] }>(`/v1/deals/${encodeURIComponent(dealId)}/import-targets`),
  uploadCsv: (dealId: string, system: string, fileName: string, body: Uint8Array<ArrayBuffer>, target?: string) =>
    apiUploadCsv(
      `/v1/deals/${encodeURIComponent(dealId)}/uploads?${new URLSearchParams({ system, fileName, ...(target ? { target } : {}) }).toString()}`,
      body,
    ),
  previewImport: (dealId: string, uploadId: string, mapping: ImportMappingBody) =>
    apiPost<ImportPreviewView>(
      `/v1/deals/${encodeURIComponent(dealId)}/uploads/${encodeURIComponent(uploadId)}/preview`,
      { mapping },
    ),
  selectSheet: (dealId: string, uploadId: string, sheet: string) =>
    apiPost<UploadDetailView>(`/v1/deals/${encodeURIComponent(dealId)}/uploads/${encodeURIComponent(uploadId)}/sheet`, { sheet }),
  importProgress: (dealId: string, runId: string) =>
    apiGet<ImportProgressView>(`/v1/deals/${encodeURIComponent(dealId)}/import-runs/${encodeURIComponent(runId)}`),
  cancelUpload: (dealId: string, uploadId: string) =>
    apiSend<SourceUploadView>('POST', `/v1/deals/${encodeURIComponent(dealId)}/uploads/${encodeURIComponent(uploadId)}/cancel`, {}),
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
