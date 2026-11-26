-- Keyword retrieval over pages for pact-wide AI (T-139, ADR 0045). Expand-only; re-runnable.
-- A page's text is indexed for Postgres full-text search, under the existing RLS on document_pages: a tenant can
-- only ever rank its own pages. Pages of AI-excluded documents (people data, the uploader's choice) and purged
-- pages are never indexed. An AI run records how its pages were chosen (ids and hashes, never content).
-- Rollback: drop the triggers, the two functions, the index and the columns.
BEGIN;

ALTER TABLE document_pages ADD COLUMN IF NOT EXISTS "search_vector" tsvector;
CREATE INDEX IF NOT EXISTS document_pages_search_idx ON document_pages USING GIN ("search_vector");

-- FULL (every eligible page fitted the budget) or KEYWORD (the top-ranked pages, with the pages selected by id,
-- page number and checksum). Null for runs that are not pact-wide.
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS "retrieval" JSONB;

-- The index follows the page text. The trigger runs as pactlab_ops so it can read the document's exclusion
-- whoever writes the page (a seller's upload, the vision reading); a document it cannot see is not indexed.
GRANT UPDATE (search_vector) ON document_pages TO pactlab_ops;

CREATE OR REPLACE FUNCTION app_page_search_index() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF NEW.text IS NOT NULL AND EXISTS (
       SELECT 1 FROM documents d WHERE d.id = NEW.document_id AND d.status = 'AVAILABLE' AND NOT d.ai_excluded) THEN
    NEW.search_vector := to_tsvector('english'::regconfig, NEW.text);
  ELSE
    NEW.search_vector := NULL;
  END IF;
  RETURN NEW;
END
$$;

-- AI exclusion is one-way and a purge is final: either drops the document's pages from the index.
CREATE OR REPLACE FUNCTION app_page_search_unindex() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF NEW.ai_excluded OR NEW.status <> 'AVAILABLE' THEN
    UPDATE document_pages SET search_vector = NULL WHERE document_id = NEW.id AND search_vector IS NOT NULL;
  END IF;
  RETURN NEW;
END
$$;

ALTER FUNCTION app_page_search_index() OWNER TO pactlab_ops;
ALTER FUNCTION app_page_search_unindex() OWNER TO pactlab_ops;

DROP TRIGGER IF EXISTS document_pages_search_index ON document_pages;
CREATE TRIGGER document_pages_search_index BEFORE INSERT OR UPDATE OF text ON document_pages
  FOR EACH ROW EXECUTE FUNCTION app_page_search_index();
DROP TRIGGER IF EXISTS documents_search_unindex ON documents;
CREATE TRIGGER documents_search_unindex AFTER UPDATE OF ai_excluded, status ON documents
  FOR EACH ROW EXECUTE FUNCTION app_page_search_unindex();

-- Backfill the pages that exist (the trigger fires only on text changes). The owner backfills, so FORCE is lifted
-- (and read on documents) for the statement and restored.
ALTER TABLE documents NO FORCE ROW LEVEL SECURITY;
ALTER TABLE document_pages NO FORCE ROW LEVEL SECURITY;
UPDATE document_pages p SET search_vector = to_tsvector('english'::regconfig, p.text)
  FROM documents d
 WHERE d.id = p.document_id AND p.text IS NOT NULL AND p.search_vector IS NULL AND d.status = 'AVAILABLE' AND NOT d.ai_excluded;
ALTER TABLE document_pages FORCE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;

COMMIT;
