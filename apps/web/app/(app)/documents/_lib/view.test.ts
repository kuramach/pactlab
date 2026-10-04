import { describe, expect, it } from 'vitest';
import {
  citationHref,
  highlightQuotes,
  parseDocumentsView,
  reviewQueueOrder,
  type DocumentFindingItem,
} from './view';

const deal = '01920000-0000-7000-8000-0000000000d1';
const doc = '01920000-0000-7000-8000-00000000d0c1';

describe('documents view', () => {
  it('keeps only valid ids and page numbers', () => {
    expect(parseDocumentsView({ dealId: deal, documentId: doc, page: '3' })).toEqual({
      dealId: deal,
      documentId: doc,
      page: 3,
    });
    expect(parseDocumentsView({ dealId: 'x', documentId: ['../../etc'], page: '-1' })).toEqual({
      page: 1,
    });
  });

  it('links citation chips to the exact page', () => {
    expect(citationHref(deal, { documentId: doc, pageNumber: 3 })).toBe(
      `/documents?dealId=${deal}&documentId=${doc}&page=3`,
    );
  });

  it('orders the review queue drafts-first by severity', () => {
    const item = (
      title: string,
      status: DocumentFindingItem['status'],
      severity: DocumentFindingItem['severity'],
    ) => ({ title, status, severity }) as DocumentFindingItem;
    expect(
      reviewQueueOrder([
        item('b', 'ACCEPTED', 'CRITICAL'),
        item('c', 'DRAFT', 'INFO'),
        item('a', 'DRAFT', 'HIGH'),
      ]).map((i) => i.title),
    ).toEqual(['a', 'c', 'b']);
  });

  it('highlights cited quotes without overlap', () => {
    expect(
      highlightQuotes('Customer may terminate on a Change of Control.', [
        'may terminate',
        'missing',
      ]),
    ).toEqual([
      { text: 'Customer ', cited: false },
      { text: 'may terminate', cited: true },
      { text: ' on a Change of Control.', cited: false },
    ]);
  });
});
