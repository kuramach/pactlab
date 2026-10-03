const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EvidenceFilters {
  type?: string;
  visibility?: 'BUYER_ONLY' | 'SHARED';
  recordId?: string;
  cursor?: string;
}

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

/** Keep only filters the API accepts; anything else is dropped rather than forwarded. */
export function parseEvidenceFilters(params: SearchParams): EvidenceFilters {
  const visibility = single(params['visibility']);
  const cursor = single(params['cursor']);
  return {
    ...(single(params['type']) ? { type: single(params['type']) } : {}),
    ...(visibility === 'BUYER_ONLY' || visibility === 'SHARED' ? { visibility } : {}),
    ...(single(params['recordId']) ? { recordId: single(params['recordId']) } : {}),
    ...(cursor && UUID.test(cursor) ? { cursor } : {}),
  };
}

export function evidenceQuery(
  filters: EvidenceFilters,
  overrides: Partial<EvidenceFilters> = {},
): string {
  const merged = { ...filters, ...overrides };
  const query = new URLSearchParams();
  for (const key of ['type', 'visibility', 'recordId', 'cursor'] as const) {
    const value = merged[key];
    if (value) query.set(key, value);
  }
  return query.toString();
}

export function isUuidParam(value: string): boolean {
  return UUID.test(value);
}
