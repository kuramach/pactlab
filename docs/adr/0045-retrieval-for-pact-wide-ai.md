# ADR 0045: Retrieval for pact-wide AI: keyword search over pages first, vectors only if the evaluation says so (T-139)

**Status:** accepted (Kumar, 2026-11-17: "Do we need RAG for this project?" Not yet, but for one feature.)

## Context
- **Per-document jobs** (extraction, consistency checks, classification) read one document, which fits the context window. They stay full-text: the consistency check must see the whole agreement to notice a missing Section 9.
- **Pact-wide jobs** send every eligible document together. Document Q&A sent up to `MAX_CONTEXT_CHARS = 600_000` characters (about 150k tokens) and refused anything larger with a 422, so a real data room (hundreds of documents, millions of characters) failed on its first question across the pact.
- The spec's context strategy (§11) already says: direct long context for what fits, retrieval only for larger corpora, tenant and deal filters before ranking, and similarity search is never an authorization boundary.

## Decision
1. **Retrieval only decides which pages are sent.** The gateway, the prompt (`document.qa@1`, unchanged), grounding and the citation check are untouched; every citation is still verified against the exact page text. A pact under the budget behaves exactly as before (strategy FULL: every page, in the same order).
2. **Keyword search first, in Postgres.** No new service and no embedding provider.
   - **Index:** `document_pages.search_vector` (`tsvector`, english) with a GIN index, kept by a trigger. It sits under the existing RLS on `document_pages` and `documents`, so a tenant ranks only its own pages and a counterparty only what is shared with them.
   - **Why keyword:** contract language is precise ("change of control", "assignment", "Section 9"), and a reviewer asks in it more often than not.
   - **Query:** the question's words ORed (`websearch_to_tsquery`), ranked with `ts_rank_cd`, plus its two- and three-word runs as quoted phrases, weighted 10×. Postgres ranking knows nothing of how rare a word is, so without the phrase signal boilerplate full of "agreement", "customer" and "terminate" outranked the one page that says "change of control" (measured: keyword recall 0.83 without it, 1.00 with it).
3. **Selection is deterministic** (`selectPages`, `packages/ai/src/retrieval.ts`). Over the budget: hits best first while they fit; a strong hit (at least half the best rank) brings its previous and next page of the same document (clauses span pages); pages go to the model in document order. Ties break on document and page, so the same question on the same data sends the same pages.
4. **Coverage on every answer.** The response carries `coverage`: strategy, documents and pages searched, pages read, and for a partial read "Searched N documents (P pages); read the M most relevant pages" with the pages read for at most ten documents. An answer with no cited claims over a partial read says the answer may be in pages not read and offers to narrow the question to chosen documents (`documentIds`). A question that matches nothing over the budget is answered UNANSWERABLE without a model call.
5. **Recorded on the run.** `ai_runs.retrieval` (JSONB) holds the strategy, the budget, the counts and, for KEYWORD, each page sent by id, document, number and checksum. Never content.
6. **The budget is a knob:** `AI_CONTEXT_BUDGET_CHARS` (1,000 to 2,000,000; default 600,000), read once at startup; nonsense fails startup.

## Data rules
- **No people data in the index (rule 7).** A page is indexed only when its document is AVAILABLE and not AI-excluded; HR, compensation, performance and named-contribution documents are always AI-excluded (database CHECK), so they are never indexed. Excluding a document later (one-way) or purging it clears its pages from the index. Retrieval also searches only the documents the job already deems eligible.
- **Exclusions and visibility apply exactly as to sources today:** the documents searched are the eligible ones the caller can see; RLS applies a second time inside the ranking query.
- **Citations (rule 4):** unchanged gate; a recalled page is answered only through a verified citation.
- **Lists (T-126):** coverage lists at most ten documents (the rest are counted); the ranking query is LIMITed and its rows are never returned as a list.

## Evaluation and the decision on vectors
- **The set:** `packages/ai/src/evals/retrieval-room.ts`, a generated synthetic data room (60 agreements × 25 pages, about 2.4M characters, four times the budget) with eight planted clauses and 13 questions: six in the documents' words, seven paraphrased ("can they walk away if we buy them?" against change-of-control text). Run by `apps/api/src/documents/retrieval.api.test.ts` against real Postgres ranking.
- **Measured (2026-11-25):**

  | Questions | Budget | Recall@budget | End-to-end answered and cited |
  |---|---|---|---|
  | Documents' words (6) | 600,000 | 1.00 | 1.00 |
  | Paraphrased (7) | 600,000 | 0.71 | 0.71 |
  | Documents' words (6) | 60,000 | 1.00 | 1.00 |
  | Paraphrased (7) | 60,000 | 0.43 | 0.43 |

  End-to-end runs through the real selection, prompt, grounding and citation check with a scripted model that answers only from the planted clause, so it measures the pipeline; a live model's answer quality belongs to the live eval.
- **Misses:** "Can they walk away if we buy them?" and "Can they hand the contract over to another company?" share no word with their clauses and read nothing; at the tight budget two more paraphrases fall outside the pages that fit.
- **Decision:** keyword search ships now: it answers in the documents' words at any tested budget and removes the 422. **Vectors are warranted for paraphrased questions** (0.71 recall at the default budget, and the headline example misses), so step 5 of T-139 proceeds as its own PR: `pgvector` per page chunk under RLS, reciprocal rank fusion with the keyword ranking (never vectors alone), the embedding provider behind an adapter with a fixture, in the catalog under the ADR 0034 data-terms gate, metered in Hosting cost, re-embedded on page change and deleted with a purge. The eval set above is its acceptance bar: paraphrase recall must rise and keyword recall must stay 1.00.

## Consequences
- A data room of any size gets an answer with cited pages and a statement of what was read, instead of "too much to read".
- Recall for colloquial questions is limited until vectors land; the coverage note keeps a miss from reading as "not in the data room".
- **Migration** `20270107000000_page_search` is expand-only (a column, an index, a JSONB column on `ai_runs`, two trigger functions owned by `pactlab_ops`, and a backfill). Rollback: drop the triggers, `app_page_search_index()`, `app_page_search_unindex()`, the index and both columns; Q&A then needs the earlier release (which refused over the budget).
