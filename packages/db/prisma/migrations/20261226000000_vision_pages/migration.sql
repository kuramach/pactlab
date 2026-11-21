-- Reading pages from their images (T-121): scanned PDFs, image uploads, PowerPoint slides, and charts or
-- image tables inside documents. A page records where its text came from and whether it waits to be read;
-- a document records the reading's progress, so it is never silent (T-125). Expand-only; re-runnable.
-- Rollback: drop the added columns.
BEGIN;

-- TEXT: the file's own text layer; VISION: read by AI from the page image; TEXT_AND_VISION: both (a chart
-- or image table on a text page, appended under "From the page image:").
ALTER TABLE document_pages ADD COLUMN IF NOT EXISTS "text_source" TEXT NOT NULL DEFAULT 'TEXT';
-- REPLACE: the page has no text of its own (a scan, an image); APPEND: add what the image shows. NULL: nothing to read.
ALTER TABLE document_pages ADD COLUMN IF NOT EXISTS "vision_mode" TEXT;
ALTER TABLE document_pages DROP CONSTRAINT IF EXISTS document_pages_text_source_check;
ALTER TABLE document_pages ADD CONSTRAINT document_pages_text_source_check CHECK ("text_source" IN ('TEXT', 'VISION', 'TEXT_AND_VISION'));
ALTER TABLE document_pages DROP CONSTRAINT IF EXISTS document_pages_vision_mode_check;
ALTER TABLE document_pages ADD CONSTRAINT document_pages_vision_mode_check CHECK ("vision_mode" IS NULL OR "vision_mode" IN ('REPLACE', 'APPEND'));

-- NONE: nothing to read. PENDING, READING, then DONE, PARTIAL (some pages could not be read) or FAILED;
-- SKIPPED: the document is excluded from AI (people data or the uploader's choice), so images are never sent.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS "vision_status" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS "vision_pages_total" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS "vision_pages_done" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS "vision_started_at" TIMESTAMPTZ(3);
-- Pages that could not be read, with why: [{ "page": 7, "reason": "unreadable" }]. Never document content.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS "vision_failures" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_vision_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_vision_status_check CHECK ("vision_status" IN ('NONE', 'PENDING', 'READING', 'DONE', 'PARTIAL', 'FAILED', 'SKIPPED'));

-- Writing the reading's results. Page updates are buyer-side only under RLS, but a seller's scan must be read
-- too: these functions let the caller write the reading of a document they may see and either uploaded or
-- work on as the buyer side, and only the reading columns. They run as pactlab_ops, with the caller's
-- tenant settings (app_current_*) still in force for the access check.
GRANT SELECT, UPDATE (vision_status, vision_pages_done, vision_started_at, vision_failures) ON documents TO pactlab_ops;
GRANT SELECT, UPDATE (text, checksum, text_source, vision_mode) ON document_pages TO pactlab_ops;
DROP POLICY IF EXISTS documents_vision_ops ON documents;
CREATE POLICY documents_vision_ops ON documents FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS document_pages_vision_ops ON document_pages;
CREATE POLICY document_pages_vision_ops ON document_pages FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);

-- The tenant helpers the access check uses.
-- (app_current_deal_ids and app_is_buyer_side read deal memberships; ops already reads organizations, deals and
-- organization memberships for the console.)
GRANT SELECT ON deal_memberships TO pactlab_ops;
DROP POLICY IF EXISTS deal_memberships_vision_ops ON deal_memberships;
CREATE POLICY deal_memberships_vision_ops ON deal_memberships FOR SELECT TO pactlab_ops USING (true);
GRANT EXECUTE ON FUNCTION app_current_organization_id(), app_current_deal_ids(), app_current_user_id(), app_is_buyer_side(uuid) TO pactlab_ops;

CREATE OR REPLACE FUNCTION app_vision_may_write(p_document uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM documents d
       WHERE d.id = p_document AND d.organization_id = app_current_organization_id() AND d.deal_id = ANY (app_current_deal_ids())
         AND d.status = 'AVAILABLE' AND NOT d.ai_excluded
         AND (app_is_buyer_side(d.deal_id) OR d.uploaded_by = app_current_user_id()))
  $$;

-- Claim the reading (one at a time; a stale one, after a restart, may be taken over).
CREATE OR REPLACE FUNCTION app_vision_claim(p_document uuid, p_stale_minutes integer) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF NOT app_vision_may_write(p_document) THEN RETURN false; END IF;
  UPDATE documents SET vision_status = 'READING', vision_started_at = now()
   WHERE id = p_document
     AND (vision_status IN ('PENDING', 'FAILED', 'PARTIAL')
          OR (vision_status = 'READING' AND vision_started_at < now() - make_interval(mins => greatest(p_stale_minutes, 1))));
  RETURN FOUND;
END
$$;

-- Store one page's reading and the document's progress.
CREATE OR REPLACE FUNCTION app_vision_page_set(p_page uuid, p_text text, p_checksum text, p_source text, p_done integer) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE v_document uuid;
BEGIN
  SELECT document_id INTO v_document FROM document_pages WHERE id = p_page;
  IF v_document IS NULL OR NOT app_vision_may_write(v_document) OR p_source NOT IN ('VISION', 'TEXT_AND_VISION') THEN RETURN false; END IF;
  UPDATE document_pages SET text = p_text, checksum = p_checksum, text_source = p_source, vision_mode = NULL WHERE id = p_page;
  UPDATE documents SET vision_pages_done = p_done WHERE id = v_document;
  RETURN true;
END
$$;

-- Finish: the outcome and the pages that could not be read (page numbers and reasons only).
CREATE OR REPLACE FUNCTION app_vision_finish(p_document uuid, p_status text, p_failures jsonb) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF p_status NOT IN ('DONE', 'PARTIAL', 'FAILED', 'SKIPPED') THEN RETURN false; END IF;
  -- SKIPPED may be written for an excluded document (people data), which app_vision_may_write refuses.
  IF NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = p_document AND d.organization_id = app_current_organization_id() AND d.deal_id = ANY (app_current_deal_ids())
                   AND (app_is_buyer_side(d.deal_id) OR d.uploaded_by = app_current_user_id())) THEN RETURN false; END IF;
  UPDATE documents SET vision_status = p_status, vision_failures = coalesce(p_failures, '[]'::jsonb) WHERE id = p_document;
  RETURN true;
END
$$;

-- Record one reading's AI run (for cost and audit). AI runs are buyer-side only under RLS; a seller's scan is
-- read too, so its run is written here, for the document's own pact, and only for the vision prompt.
GRANT INSERT ON ai_runs TO pactlab_ops;
DROP POLICY IF EXISTS ai_runs_vision_ops ON ai_runs;
CREATE POLICY ai_runs_vision_ops ON ai_runs FOR INSERT TO pactlab_ops WITH CHECK (prompt_id = 'document.vision');
CREATE OR REPLACE FUNCTION app_vision_record_run(p_document uuid, p_run jsonb) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE v_org uuid; v_deal uuid;
BEGIN
  IF NOT app_vision_may_write(p_document) OR p_run->>'promptId' <> 'document.vision' THEN RETURN false; END IF;
  SELECT organization_id, deal_id INTO v_org, v_deal FROM documents WHERE id = p_document;
  INSERT INTO ai_runs (id, organization_id, deal_id, task_type, prompt_id, prompt_version, prompt_hash, model_alias, resolved_model_id, resolved_provider,
                       job_type, fallback_from, fallback_reason, input_hashes, output_hash, status, repair_attempted, injection_signals,
                       input_tokens, output_tokens, latency_ms, created_at, requested_by)
  VALUES ((p_run->>'id')::uuid, v_org, v_deal, p_run->>'taskType', p_run->>'promptId', p_run->>'promptVersion', p_run->>'promptHash', p_run->>'modelAlias',
          p_run->>'resolvedModelId', coalesce(p_run->>'resolvedProvider', 'bedrock'), p_run->>'jobType', p_run->>'fallbackFrom', p_run->>'fallbackReason',
          ARRAY(SELECT jsonb_array_elements_text(coalesce(p_run->'inputHashes', '[]'::jsonb))), p_run->>'outputHash', (p_run->>'status')::ai_run_status,
          coalesce((p_run->>'repairAttempted')::boolean, false), coalesce((p_run->>'injectionSignals')::int, 0), coalesce((p_run->>'inputTokens')::int, 0),
          coalesce((p_run->>'outputTokens')::int, 0), coalesce((p_run->>'latencyMs')::int, 0), (p_run->>'createdAt')::timestamptz, app_current_user_id())
  ON CONFLICT (id) DO NOTHING;
  RETURN true;
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['app_vision_record_run(uuid, jsonb)', 'app_vision_may_write(uuid)', 'app_vision_claim(uuid, integer)', 'app_vision_page_set(uuid, text, text, text, integer)', 'app_vision_finish(uuid, text, jsonb)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;

-- PowerPoint and images are data-room documents too (T-121). Expand-only: the allowed set grows.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_content_type;
ALTER TABLE documents ADD CONSTRAINT documents_content_type
  CHECK (content_type IN (
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg'
  ));

COMMIT;
