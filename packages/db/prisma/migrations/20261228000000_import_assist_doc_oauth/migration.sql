-- Real-world imports and OAuth document sources (Kumar, 2026-11-21). Expand only: every column is
-- nullable and nothing existing changes meaning; rollback is dropping the new columns (and leaving
-- the enum value, which Postgres cannot drop and nothing else uses).

-- A profit and loss statement, line by line: every pact can import one.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'FINANCIAL_PNL';

-- The header's row among the sheet's non-empty rows (title rows above it are left out); null reads
-- the file as before (header on the first row). `assist` is the mapping assistant's checked proposal,
-- shown on the mapping screen: picks, reasons and questions, never a value from the file.
ALTER TABLE source_uploads ADD COLUMN header_row integer NULL CHECK (header_row IS NULL OR header_row BETWEEN 1 AND 30);
ALTER TABLE source_uploads ADD COLUMN assist jsonb NULL;
GRANT UPDATE (header_row, assist) ON source_uploads TO pactlab_app;

-- A LIVE document source signed in through the organization's own Google Drive or OneDrive connection
-- (OAuth, refreshed by Pactlab) instead of a pasted token. Old token sources keep credential_ref.
ALTER TABLE document_sources ADD COLUMN organization_connection_id uuid NULL REFERENCES organization_connections (id) ON DELETE RESTRICT;
CREATE INDEX document_sources_organization_connection_idx ON document_sources (organization_connection_id) WHERE organization_connection_id IS NOT NULL;

-- The mapping assistant's run (cost, audit trail). AI runs are buyer-side only under RLS, and a seller
-- uploads imports too, so the run is written here: for the caller's own organization and one of the
-- caller's deals (both from the session, never from the caller), and only for the mapping prompt.
DROP POLICY IF EXISTS ai_runs_import_ops ON ai_runs;
CREATE POLICY ai_runs_import_ops ON ai_runs FOR INSERT TO pactlab_ops WITH CHECK (prompt_id = 'import.map');
CREATE OR REPLACE FUNCTION app_import_record_run(p_deal uuid, p_run jsonb) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF app_current_organization_id() IS NULL OR NOT (p_deal = ANY (app_current_deal_ids())) OR p_run->>'promptId' <> 'import.map' THEN RETURN false; END IF;
  INSERT INTO ai_runs (id, organization_id, deal_id, task_type, prompt_id, prompt_version, prompt_hash, model_alias, resolved_model_id, resolved_provider,
                       job_type, fallback_from, fallback_reason, input_hashes, output_hash, status, repair_attempted, injection_signals,
                       input_tokens, output_tokens, latency_ms, created_at, requested_by)
  VALUES ((p_run->>'id')::uuid, app_current_organization_id(), p_deal, p_run->>'taskType', p_run->>'promptId', p_run->>'promptVersion', p_run->>'promptHash', p_run->>'modelAlias',
          p_run->>'resolvedModelId', coalesce(p_run->>'resolvedProvider', 'bedrock'), p_run->>'jobType', p_run->>'fallbackFrom', p_run->>'fallbackReason',
          ARRAY(SELECT jsonb_array_elements_text(coalesce(p_run->'inputHashes', '[]'::jsonb))), p_run->>'outputHash', (p_run->>'status')::ai_run_status,
          coalesce((p_run->>'repairAttempted')::boolean, false), coalesce((p_run->>'injectionSignals')::int, 0), coalesce((p_run->>'inputTokens')::int, 0),
          coalesce((p_run->>'outputTokens')::int, 0), coalesce((p_run->>'latencyMs')::int, 0), (p_run->>'createdAt')::timestamptz, app_current_user_id())
  ON CONFLICT (id) DO NOTHING;
  RETURN true;
END
$$;
ALTER FUNCTION app_import_record_run(uuid, jsonb) OWNER TO pactlab_ops;
REVOKE ALL ON FUNCTION app_import_record_run(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_import_record_run(uuid, jsonb) TO pactlab_app;

-- An organization's Google Drive and OneDrive / SharePoint sign-ins sit beside its DocuSign (one live
-- connection per provider, as before). base_uri is the provider's API it reads from.
ALTER TABLE organization_connections DROP CONSTRAINT IF EXISTS organization_connections_provider_check;
ALTER TABLE organization_connections ADD CONSTRAINT organization_connections_provider_check CHECK ("provider" IN ('docusign', 'google-drive', 'onedrive'));
