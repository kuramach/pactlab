import type { TransactionClient } from './client';

/**
 * Keyword retrieval over document pages (T-139, ADR 0047). Runs inside the caller's tenant transaction, so the
 * RLS on document_pages and documents decides which pages can rank at all: another tenant's pages, and
 * documents a counterparty may not see, never match. AI-excluded and purged pages carry no index (trigger).
 */

/** The most hits one question ranks; selection stops at the budget long before this. */
export const MAX_RANKED_PAGES = 2_000;

/**
 * The question as an OR of its words, for `websearch_to_tsquery`: a diligence question is phrased as a
 * sentence, and requiring every word ("can", "they", "walk", …) on one page would match almost nothing.
 * Postgres drops the stop words; `ts_rank_cd` still rewards pages where the words sit close together.
 */
export function keywordQuery(question: string): string {
  return [...new Set(words(question))].filter((word) => word !== 'or').slice(0, 64).join(' or ');
}

/**
 * The question's runs of two and three words, as quoted phrases ("change of control", "governing law"). Postgres
 * ranking has no notion of how rare a word is, so boilerplate full of "agreement" and "customer" would outrank
 * the one clause that says "change of control"; a phrase match is what tells them apart. Phrases that reduce to
 * fewer than two real words (stop words only) are dropped in SQL.
 */
export function keywordPhrases(question: string): string[] {
  const list = words(question).filter((word) => word !== 'or');
  const phrases = new Set<string>();
  for (const size of [2, 3]) {
    for (let at = 0; at + size <= list.length; at += 1) phrases.add(`"${list.slice(at, at + size).join(' ')}"`);
  }
  return [...phrases].slice(0, 64);
}

/** How much more a phrase match counts than the words alone. */
export const PHRASE_WEIGHT = 10;

function words(question: string): string[] {
  return question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export interface RankedPage {
  readonly pageId: string;
  readonly documentId: string;
  readonly pageNumber: number;
  readonly rank: number;
}

/**
 * Pages of the given documents that match the question, best first. Ties break on document and page, so the
 * same question on the same data ranks the same pages in the same order.
 */
export async function rankPages(
  tx: TransactionClient,
  input: { dealId: string; documentIds: readonly string[]; question: string; limit?: number },
): Promise<RankedPage[]> {
  const query = keywordQuery(input.question);
  if (query === '' || input.documentIds.length === 0) return [];
  const limit = Math.min(Math.max(input.limit ?? MAX_RANKED_PAGES, 1), MAX_RANKED_PAGES);
  // bounded: LIMIT caps the hits; they choose which pages are read and are never returned as a list.
  const rows = await tx.$queryRaw<{ id: string; document_id: string; page_number: number; rank: number }[]>`
    WITH word AS (SELECT websearch_to_tsquery('english'::regconfig, ${query}) AS q),
         phrase AS (
           SELECT nullif(string_agg('(' || x.q::text || ')', ' | '), '')::tsquery AS q
             FROM (SELECT DISTINCT websearch_to_tsquery('english'::regconfig, text) AS q FROM unnest(${keywordPhrases(input.question)}::text[]) AS text) x
            WHERE numnode(x.q) >= 3)
    SELECT p.id::text AS id, p.document_id::text AS document_id, p.page_number,
           (ts_rank_cd(p.search_vector, word.q) + ${PHRASE_WEIGHT} * coalesce(ts_rank_cd(p.search_vector, phrase.q), 0))::float8 AS rank
      FROM document_pages p, word, phrase
     WHERE p.deal_id = ${input.dealId}::uuid
       AND p.document_id = ANY (${[...input.documentIds]}::uuid[])
       AND p.search_vector @@ word.q
     ORDER BY rank DESC, p.document_id, p.page_number
     LIMIT ${limit}`;
  return rows.map((row) => ({ pageId: row.id, documentId: row.document_id, pageNumber: row.page_number, rank: Number(row.rank) }));
}

export interface PageSize {
  readonly pageId: string;
  readonly documentId: string;
  readonly pageNumber: number;
  readonly checksum: string;
  /** Characters of page text; 0 when the page has none (purged, waiting to be read). */
  readonly chars: number;
}

/** Every page of the given documents, without its text: enough to decide whether they fit the budget. */
export async function pageSizes(
  tx: TransactionClient,
  input: { dealId: string; documentIds: readonly string[] },
): Promise<PageSize[]> {
  if (input.documentIds.length === 0) return [];
  // whole-set: the budget check needs every page's length; the rows are never returned as a list.
  const rows = await tx.$queryRaw<{ id: string; document_id: string; page_number: number; checksum: string; chars: number }[]>`
    SELECT p.id::text AS id, p.document_id::text AS document_id, p.page_number, p.checksum,
           coalesce(length(p.text), 0)::int AS chars
      FROM document_pages p
     WHERE p.deal_id = ${input.dealId}::uuid AND p.document_id = ANY (${[...input.documentIds]}::uuid[])
     ORDER BY p.document_id, p.page_number`;
  return rows.map((row) => ({ pageId: row.id, documentId: row.document_id, pageNumber: row.page_number, checksum: row.checksum, chars: Number(row.chars) }));
}
