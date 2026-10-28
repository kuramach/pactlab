import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentFindingItem } from '../../../documents/_lib/view';
import { libraryRows, type LibraryRow } from './library';
import { mergeQueue, queueCounts, ReviewQueue } from './review-queue';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('./actions', () => ({ decideDocumentFinding: vi.fn(), extractOne: vi.fn() }));

const finding = (id: string, status: DocumentFindingItem['status']): DocumentFindingItem => ({
  id,
  documentId: 'doc-1',
  title: `Finding ${id}`,
  summary: 'Synthetic.',
  severity: 'MEDIUM',
  status,
  version: 1,
  citations: [{ citationId: `c-${id}`, documentId: 'doc-1', pageNumber: 2, quote: 'clause 14' }],
  provenance: { promptId: 'contract-extraction', promptVersion: '1', resolvedModelId: 'claude' },
  reviewer: null,
  decidedAt: null,
});

describe('review queue (T-094 B4, B6)', () => {
  it('shows an in-flight decision at once, and lets the server answer win', () => {
    const findings = [finding('a', 'DRAFT'), finding('b', 'DRAFT')];
    const pending = mergeQueue(findings, { a: { status: 'ACCEPTED', rationale: 'Clause 14 matches.', saving: true } });
    expect(pending.map((item) => [item.status, item.saving])).toEqual([
      ['ACCEPTED', true],
      ['DRAFT', false],
    ]);
    // The server has since recorded a rejection: its status wins over the stale override.
    const confirmed = mergeQueue([{ ...findings[0]!, status: 'REJECTED' }, findings[1]!], { a: { status: 'ACCEPTED', rationale: 'x', saving: false } });
    expect(confirmed[0]?.status).toBe('REJECTED');
  });

  it('a rolled-back decision (override removed) returns the item to pending', () => {
    expect(mergeQueue([finding('a', 'DRAFT')], {})[0]?.status).toBe('DRAFT');
  });

  it('counts pending, accepted and rejected for the header, and renders them as filters', () => {
    const items = mergeQueue([finding('a', 'DRAFT'), finding('b', 'ACCEPTED'), finding('c', 'REJECTED'), finding('d', 'DRAFT')], {
      d: { status: 'ACCEPTED', rationale: 'ok', saving: true },
    });
    expect(queueCounts(items)).toEqual({ ALL: 4, DRAFT: 1, ACCEPTED: 2, REJECTED: 1 });
    const html = renderToStaticMarkup(<ReviewQueue dealId="d" findings={[finding('a', 'DRAFT'), finding('b', 'ACCEPTED')]} reviewer reviewerName="Lead" />);
    expect(html).toContain('aria-label="Filter the review queue"');
    expect(html).toMatch(/Pending <span aria-label="1 pending">1<\/span>/);
    expect(html).toMatch(/Accepted <span aria-label="1 accepted">1<\/span>/);
    // Decisions are buttons, not a form post that reloads the page.
    expect(html).not.toContain('<form');
    expect(html).toContain('type="button"');
  });
});

describe('document library (T-094 B11)', () => {
  const row = (fileName: string, contentType: string, createdAt: string, pageCount: number, findings: number): LibraryRow => ({
    id: fileName,
    fileName,
    contentType,
    pageCount,
    status: 'AVAILABLE',
    visibility: 'BUYER_ONLY',
    aiExcluded: false,
    retentionClass: 'DEAL',
    createdAt,
    findings,
    pending: 0,
  });
  const rows = Array.from({ length: 24 }, (_, i) =>
    row(`${String(i + 1).padStart(2, '0')}-doc.${i % 3 === 0 ? 'xlsx' : 'pdf'}`, i % 3 === 0 ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf', `2026-10-${String(1 + i).padStart(2, '0')}T00:00:00Z`, 1 + (i % 7), i % 4),
  );

  it('searches by name, filters by type and sorts by any column at 20+ documents', () => {
    expect(libraryRows(rows, '07', 'ALL', 'name', false).map((r) => r.fileName)).toEqual(['07-doc.xlsx']);
    expect(libraryRows(rows, '', 'Excel', 'name', false)).toHaveLength(8);
    expect(libraryRows(rows, '', 'ALL', 'uploaded', true)[0]?.fileName).toBe('24-doc.pdf');
    const byPages = libraryRows(rows, '', 'ALL', 'pages', true);
    expect(byPages[0]?.pageCount).toBe(7);
  });
});
