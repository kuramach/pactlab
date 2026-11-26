# Document Q&A over a large data room (retrieval)

Use when a deal team says an answer missed something, read "only the most relevant pages", or asks why a question
took a different path. Design: ADR 0047 (T-139).

## How it works
- A question across the pact reads every eligible page when they fit the budget (`AI_CONTEXT_BUDGET_CHARS`, default
  600,000 characters). The answer's coverage says "Read all P pages of N documents".
- Over the budget, Postgres keyword search ranks the pages for the question and the top pages (plus the neighbours of
  strong hits) are read until the budget is full. Coverage says "Searched N documents (P pages); read the M most
  relevant pages", with which pages.
- AI-excluded documents (including all people data) and purged pages are never indexed or sent.

## When an answer missed
1. Ask for the request id. Find the run: `SELECT id, retrieval->>'strategy', retrieval->>'pagesRead' FROM ai_runs
   WHERE task_type = 'document.question' AND deal_id = '<deal>' ORDER BY created_at DESC LIMIT 5;` (as the
   migration owner, in the deal's environment). `retrieval->'pages'` lists the pages sent by id and checksum, never text.
2. If the answer's page is not among them, the question's words did not match the clause (keyword search does not
   know synonyms). Tell the team to use the documents' words ("change of control", "assignment") or to narrow the
   question to chosen documents in the Ask box: a narrowed set that fits is read whole.
3. If a page is missing from the index altogether: `SELECT count(*) FILTER (WHERE search_vector IS NULL AND text IS
   NOT NULL) FROM document_pages WHERE document_id = '<doc>';`. Non-zero for an AVAILABLE, not AI-excluded document
   means the trigger did not run (for example, rows written before the migration and missed by the backfill). Re-run
   the backfill statement from `20270109000000_page_search` for that document; never edit page text to fix it.

## Changing the budget
- `AI_CONTEXT_BUDGET_CHARS` is read at startup (1,000 to 2,000,000). Raising it sends more per question (cost and
  latency; check Hosting cost) and must stay inside the routed model's context window. Lowering it reads fewer pages:
  run `pnpm --filter @pactlab/api exec vitest run src/documents/retrieval.api.test.ts` and compare the recall table
  with ADR 0047 first.

## Never
- Never paste page text, questions or answers into tickets: reference run ids and page ids.
- Never lift an AI exclusion to get a page indexed; it is one-way by design.
