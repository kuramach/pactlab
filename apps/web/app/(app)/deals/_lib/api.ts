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

export const dealsApi = {
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
