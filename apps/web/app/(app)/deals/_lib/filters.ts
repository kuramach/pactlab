const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EvidenceFilters {
  type?: string;
  visibility?: 'BUYER_ONLY' | 'SHARED';
  recordId?: string;
  cursor?: string;
  /** Cursors of the earlier pages, oldest first, so Previous can step back (page 1 has none). */
  trail?: string[];
}

/** Deepest page a trail may describe; beyond it the URL would grow unreasonably long. */
export const MAX_TRAIL = 200;

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

/** Keep only filters the API accepts; anything else is dropped rather than forwarded. */
export function parseEvidenceFilters(params: SearchParams): EvidenceFilters {
  const visibility = single(params['visibility']);
  const rawCursor = single(params['cursor']);
  const rawTrail = Array.isArray(params['trail']) ? params['trail'][0] : params['trail'];
  const trail = rawTrail ? rawTrail.split(',') : [];
  // A position we cannot trust (bad cursor, bad or overlong trail, or a trail without a cursor) restarts at page 1.
  const positioned =
    rawCursor !== undefined && UUID.test(rawCursor) && trail.length <= MAX_TRAIL && trail.every((entry) => UUID.test(entry));
  return {
    ...(single(params['type']) ? { type: single(params['type']) } : {}),
    ...(visibility === 'BUYER_ONLY' || visibility === 'SHARED' ? { visibility } : {}),
    ...(single(params['recordId']) ? { recordId: single(params['recordId']) } : {}),
    ...(positioned ? { cursor: rawCursor, ...(trail.length > 0 ? { trail } : {}) } : {}),
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
  if (merged.cursor && merged.trail && merged.trail.length > 0) query.set('trail', merged.trail.join(','));
  return query.toString();
}

/** What the API needs: filters and the current cursor only — the trail stays in the browser URL. */
export function evidenceApiQuery(filters: EvidenceFilters): string {
  return evidenceQuery({ ...filters, trail: undefined });
}

export interface EvidencePager {
  /** "342 records" */
  readonly totalLabel: string;
  /** "51–100 of 342"; null when nothing matches. */
  readonly windowLabel: string | null;
  /** Query strings for the neighbouring pages, keeping every filter; null when there is none. */
  readonly previous: string | null;
  readonly next: string | null;
}

/**
 * Position and neighbours of the current evidence page. Pages before this one
 * were full, so the window starts at (pages before) × limit + 1. Cursor
 * pagination is unchanged: Next uses the API's nextCursor, Previous the trail.
 */
export function evidencePager(filters: EvidenceFilters, page: { itemCount: number; total: number; limit: number; nextCursor: string | null }): EvidencePager {
  const trail = filters.trail ?? [];
  const before = filters.cursor ? trail.length + 1 : 0;
  const first = before * page.limit + 1;
  const count = new Intl.NumberFormat('en-US');
  return {
    totalLabel: `${count.format(page.total)} ${page.total === 1 ? 'record' : 'records'}`,
    windowLabel: page.itemCount === 0 ? null : `${count.format(first)}–${count.format(first + page.itemCount - 1)} of ${count.format(page.total)}`,
    previous: filters.cursor ? evidenceQuery(filters, { cursor: trail.at(-1), trail: trail.slice(0, -1) }) : null,
    next: page.nextCursor ? evidenceQuery(filters, { cursor: page.nextCursor, trail: filters.cursor ? [...trail, filters.cursor] : [] }) : null,
  };
}

export function isUuidParam(value: string): boolean {
  return UUID.test(value);
}
