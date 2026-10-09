const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Record<string, string | string[] | undefined>;

export interface DocumentsView {
  dealId?: string;
  documentId?: string;
  page: number;
}

/** Mirrors the API's document finding view (document AI drafts and decisions). */
export interface DocumentFindingItem {
  id: string;
  documentId: string;
  title: string;
  summary: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'DRAFT' | 'ACCEPTED' | 'REJECTED';
  version: number;
  citations: { citationId: string; documentId: string; pageNumber: number; quote: string }[];
  provenance: { promptId: string; promptVersion: string; resolvedModelId: string };
  reviewer: { userId: string; displayName: string } | null;
  decidedAt: string | null;
}

export interface DocumentListItem {
  id: string;
  fileName: string;
  pageCount: number;
  status: 'AVAILABLE' | 'PURGED';
  visibility: 'BUYER_ONLY' | 'SHARED';
  aiExcluded: boolean;
  retentionClass: string;
  createdAt: string;
}

export interface DocumentPageView {
  documentId: string;
  fileName: string;
  pageNumber: number;
  pageCount: number;
  text: string | null;
  available: boolean;
}

function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

/** Only well-formed ids and page numbers reach the API. */
export function parseDocumentsView(params: SearchParams): DocumentsView {
  const dealId = single(params['dealId']);
  const documentId = single(params['documentId']);
  const page = Number.parseInt(single(params['page']) ?? '1', 10);
  return {
    ...(dealId && UUID.test(dealId) ? { dealId } : {}),
    ...(documentId && UUID.test(documentId) ? { documentId } : {}),
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** Citation chips open the exact cited page. */
export function citationHref(
  dealId: string,
  citation: { documentId: string; pageNumber: number },
): string {
  const query = new URLSearchParams({
    documentId: citation.documentId,
    page: String(citation.pageNumber),
  });
  return `/deals/${dealId}/documents?${query.toString()}`;
}

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;

/** Review queue order: drafts first, then severity, then title. */
export function reviewQueueOrder(items: readonly DocumentFindingItem[]): DocumentFindingItem[] {
  return [...items].sort(
    (a, b) =>
      Number(a.status !== 'DRAFT') - Number(b.status !== 'DRAFT') ||
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      a.title.localeCompare(b.title),
  );
}

/** Split page text around cited quotes so the UI can highlight them. */
export function highlightQuotes(
  text: string,
  quotes: readonly string[],
): { text: string; cited: boolean }[] {
  const ranges = quotes
    .filter((quote) => quote.length > 0)
    .flatMap((quote) => {
      const at = text.indexOf(quote);
      return at === -1 ? [] : [[at, at + quote.length] as const];
    })
    .sort((x, y) => x[0] - y[0]);
  const parts: { text: string; cited: boolean }[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    if (start > cursor) parts.push({ text: text.slice(cursor, start), cited: false });
    parts.push({ text: text.slice(start, end), cited: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), cited: false });
  return parts;
}
