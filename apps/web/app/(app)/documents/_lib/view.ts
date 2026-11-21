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
  /** The document's file name (T-126: the library is paged, so the queue names its documents itself). */
  documentName?: string;
  title: string;
  summary: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'DRAFT' | 'ACCEPTED' | 'REJECTED';
  version: number;
  citations: { citationId: string; documentId: string; pageNumber: number; quote: string }[];
  provenance: { promptId: string; promptVersion: string; resolvedModelId: string };
  reviewer: { userId: string; displayName: string } | null;
  decidedAt: string | null;
  /** The reviewer's reason for the latest decision. */
  decisionRationale?: string | null;
}

export interface DocumentListItem {
  id: string;
  fileName: string;
  contentType: string;
  pageCount: number;
  status: 'AVAILABLE' | 'PURGED';
  visibility: 'BUYER_ONLY' | 'SHARED';
  aiExcluded: boolean;
  retentionClass: string;
  createdAt: string;
  /** Intake (T-098): what the file is and who decided. */
  intake?: DocumentIntakeView;
  /** The data room it was read from, and whether it is still there. */
  source?: { sourceId: string; state: 'CURRENT' | 'REPLACED' | 'REMOVED' } | null;
  /** T-121: pages read from their images (scans, image uploads, slides, charts), and what could not be read. */
  vision?: DocumentVisionView;
}

export interface DocumentVisionView {
  status: 'NONE' | 'PENDING' | 'READING' | 'DONE' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  pagesTotal: number;
  pagesDone: number;
  failures: { page: number; reason: string }[];
}

/** What the library says about reading a document's images (T-121); null when there is nothing to say. */
export function visionLine(vision: DocumentVisionView | undefined): { text: string; retry: boolean } | null {
  if (!vision || vision.status === 'NONE') return null;
  const first = vision.failures[0];
  const unread = first ? (first.page > 0 ? `couldn’t read page ${first.page}: ${first.reason}` : first.reason) : '';
  switch (vision.status) {
    case 'PENDING':
    case 'READING':
      return { text: `Reading images… ${vision.pagesDone} of ${vision.pagesTotal}`, retry: false };
    case 'DONE':
      return { text: `Read from images (${vision.pagesTotal} ${vision.pagesTotal === 1 ? 'page' : 'pages'}): check against the original`, retry: false };
    case 'PARTIAL':
      return { text: `Read ${vision.pagesDone} of ${vision.pagesTotal} pages from images; ${unread}${vision.failures.length > 1 ? ` (and ${vision.failures.length - 1} more)` : ''}`, retry: true };
    case 'FAILED':
      return { text: `Images not read: ${unread || 'the reading failed'}`, retry: true };
    case 'SKIPPED':
      return { text: 'Images not read: this document is kept away from AI', retry: false };
  }
}

export interface DocumentIntakeView {
  state: 'UNCLASSIFIED' | 'FILED' | 'NEEDS_YOU' | 'NOT_READ';
  category: string | null;
  source: 'AI' | 'PERSON' | null;
  confidence: number | null;
  reason: string | null;
  question: string | null;
  entityName: string | null;
  counterpartyName: string | null;
  sourcePath: string | null;
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
