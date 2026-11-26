import { describe, expect, it } from 'vitest';
import { recallAtBudget, retrievalRecord, selectPages, type CandidatePage } from './retrieval';

const page = (documentId: string, pageNumber: number, chars = 100): CandidatePage => ({
  pageId: `${documentId}-${pageNumber}`,
  documentId,
  pageNumber,
  checksum: 'c'.repeat(64),
  chars,
});

const room = [page('a', 1), page('a', 2), page('a', 3), page('a', 4), page('b', 1), page('b', 2), page('c', 1, 0)];

describe('page selection (T-139)', () => {
  it('reads every page with text when they fit: FULL, as before retrieval', () => {
    const selection = selectPages(room, [], 600);
    expect(selection).toMatchObject({ strategy: 'FULL', partial: false, pagesRead: 6, pagesSearched: 6, documentsSearched: 3, documentsRead: 2, charsRead: 600 });
    expect(retrievalRecord(selection)).toEqual({ strategy: 'FULL', budgetChars: 600, documentsSearched: 3, pagesSearched: 6, pagesRead: 6 });
  });

  it('over the budget takes hits best first, with the neighbours of strong hits, in document order', () => {
    const selection = selectPages(room, [{ pageId: 'b-2', rank: 0.2 }, { pageId: 'a-3', rank: 1 }, { pageId: 'a-1', rank: 0.1 }], 400);
    expect(selection.strategy).toBe('KEYWORD');
    expect(selection.partial).toBe(true);
    // a-3 is strong: a-2 and a-4 come with it; b-2 is weak (below half the best) and fills the last slot.
    expect(selection.pages.map((p) => p.pageId)).toEqual(['a-2', 'a-3', 'a-4', 'b-2']);
    expect(retrievalRecord(selection).pages?.map((p) => p.pageId)).toEqual(['a-2', 'a-3', 'a-4', 'b-2']);
  });

  it('never crosses into another document for a neighbour, and never exceeds the budget', () => {
    const selection = selectPages(room, [{ pageId: 'a-4', rank: 1 }, { pageId: 'b-1', rank: 0.9 }], 250);
    expect(selection.pages.map((p) => p.pageId)).toEqual(['a-3', 'a-4']);
    expect(selection.charsRead).toBeLessThanOrEqual(250);
  });

  it('skips a page too large for what is left and keeps filling', () => {
    const big = [page('a', 1, 300), page('a', 2, 100), page('b', 1, 100)];
    const selection = selectPages(big, [{ pageId: 'b-1', rank: 1 }, { pageId: 'a-1', rank: 0.9 }, { pageId: 'a-2', rank: 0.8 }], 250);
    expect(selection.pages.map((p) => p.pageId)).toEqual(['a-2', 'b-1']);
  });

  it('is deterministic: ties break by document order, and the same input gives the same pages', () => {
    const hits = [{ pageId: 'b-1', rank: 0.5 }, { pageId: 'a-2', rank: 0.5 }];
    const first = selectPages(room, hits, 100);
    expect(first.pages.map((p) => p.pageId)).toEqual(['a-2']);
    expect(selectPages(room, [...hits].reverse(), 100)).toEqual(first);
  });

  it('with no hits over the budget reads nothing (and says so)', () => {
    expect(selectPages(room, [], 300)).toMatchObject({ strategy: 'KEYWORD', pagesRead: 0, partial: true, pagesSearched: 6 });
  });

  it('measures recall at the budget', () => {
    expect(recallAtBudget(['a', 'b'], ['a', 'c'])).toBe(0.5);
    expect(recallAtBudget([], [])).toBe(1);
  });
});
