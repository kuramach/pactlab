/**
 * Which pages a pact-wide job sends to the model (T-139, ADR 0045). Retrieval only decides what is sent: the
 * gateway, prompts, grounding and citation checks are unchanged, and every citation is still verified against
 * the exact page text. Selection is deterministic: the same ranking over the same pages gives the same pages.
 */

/** FULL: every eligible page fitted the budget (as before retrieval). KEYWORD: the top-ranked pages. */
export type RetrievalStrategy = 'FULL' | 'KEYWORD';

/** A strong hit ranks at least this share of the best hit; its neighbouring pages are read too (clauses span pages). */
export const STRONG_HIT_SHARE = 0.5;

export interface CandidatePage {
  readonly pageId: string;
  readonly documentId: string;
  readonly pageNumber: number;
  readonly checksum: string;
  /** Characters of page text (0: nothing to read). */
  readonly chars: number;
}

export interface PageHit {
  readonly pageId: string;
  readonly rank: number;
}

export interface PageSelection {
  readonly strategy: RetrievalStrategy;
  readonly budgetChars: number;
  /** In document order (the order the candidates were given). */
  readonly pages: readonly CandidatePage[];
  readonly documentsSearched: number;
  readonly pagesSearched: number;
  readonly documentsRead: number;
  readonly pagesRead: number;
  readonly charsRead: number;
  /** True when some eligible pages were not sent (over the budget). */
  readonly partial: boolean;
}

/**
 * Under the budget every page with text is read (FULL). Over it, hits are taken best first while they fit; a
 * strong hit brings its previous and next page of the same document when those fit. Pages are returned in
 * document order so the prompt reads like the data room.
 */
export function selectPages(candidates: readonly CandidatePage[], hits: readonly PageHit[], budgetChars: number): PageSelection {
  const readable = candidates.filter((page) => page.chars > 0);
  const total = readable.reduce((sum, page) => sum + page.chars, 0);
  const documentsSearched = new Set(candidates.map((page) => page.documentId)).size;
  const summary = (strategy: RetrievalStrategy, pages: readonly CandidatePage[]): PageSelection => ({
    strategy,
    budgetChars,
    pages,
    documentsSearched,
    pagesSearched: readable.length,
    documentsRead: new Set(pages.map((page) => page.documentId)).size,
    pagesRead: pages.length,
    charsRead: pages.reduce((sum, page) => sum + page.chars, 0),
    partial: pages.length < readable.length,
  });
  if (total <= budgetChars) return summary('FULL', readable);

  const position = new Map(readable.map((page, index) => [page.pageId, index]));
  const ordered = hits
    .flatMap((hit) => {
      const index = position.get(hit.pageId);
      return index === undefined ? [] : [{ index, rank: hit.rank }];
    })
    .sort((a, b) => b.rank - a.rank || a.index - b.index);
  const strongBar = (ordered[0]?.rank ?? 0) * STRONG_HIT_SHARE;
  const chosen = new Set<number>();
  let used = 0;
  const take = (index: number) => {
    const page = readable[index];
    if (!page || chosen.has(index) || used + page.chars > budgetChars) return;
    chosen.add(index);
    used += page.chars;
  };
  for (const { index, rank } of ordered) {
    take(index);
    if (!chosen.has(index) || strongBar === 0 || rank < strongBar) continue;
    const documentId = readable[index]?.documentId;
    for (const neighbour of [index - 1, index + 1]) {
      if (readable[neighbour]?.documentId === documentId) take(neighbour);
    }
  }
  return summary('KEYWORD', readable.filter((_, index) => chosen.has(index)));
}

/** What a run records about its selection: ids and hashes, never content. */
export interface RetrievalRecord {
  readonly strategy: RetrievalStrategy;
  readonly budgetChars: number;
  readonly documentsSearched: number;
  readonly pagesSearched: number;
  readonly pagesRead: number;
  /** KEYWORD only: the pages sent, in document order. */
  readonly pages?: readonly { readonly pageId: string; readonly documentId: string; readonly pageNumber: number; readonly checksum: string }[];
}

export function retrievalRecord(selection: PageSelection): RetrievalRecord {
  const base = {
    strategy: selection.strategy,
    budgetChars: selection.budgetChars,
    documentsSearched: selection.documentsSearched,
    pagesSearched: selection.pagesSearched,
    pagesRead: selection.pagesRead,
  };
  if (selection.strategy === 'FULL') return base;
  return { ...base, pages: selection.pages.map(({ pageId, documentId, pageNumber, checksum }) => ({ pageId, documentId, pageNumber, checksum })) };
}

/** Eval measure: the share of answer pages that were among the pages sent (1 when there are none to find). */
export function recallAtBudget(selected: readonly string[], answerPages: readonly string[]): number {
  if (answerPages.length === 0) return 1;
  const sent = new Set(selected);
  return answerPages.filter((page) => sent.has(page)).length / answerPages.length;
}
