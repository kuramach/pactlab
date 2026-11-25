-- Whoever imported a file may delete (withdraw) it (Kumar, 2026-11-25: "If I imported the file, I shd be able to
-- delete it and reimport"); the deal lead or an analyst may delete anyone's, as before (the API's rule).
-- A seller works under counterparty RLS: buyer-only imports and findings are hidden from them, so a withdrawal
-- computed there could void a record a buyer's import still reads, or miss findings built on it. A seller's
-- withdrawal therefore runs here, seeing the whole pact, with the same steps as `withdrawals.withdraw`, and only
-- for an import the caller uploaded. Expand only: a function, grants and policies for it. Rollback: drop them.

GRANT SELECT ON source_uploads, evidence_voids, sync_run_evidence, finding_evidence_links, valuation_runs TO pactlab_ops;
GRANT UPDATE (status, withdrawn_at, withdrawn_by, withdrawal_reason) ON source_uploads TO pactlab_ops;
GRANT INSERT ON evidence_voids TO pactlab_ops;

DROP POLICY IF EXISTS source_uploads_withdraw_ops ON source_uploads;
CREATE POLICY source_uploads_withdraw_ops ON source_uploads FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS evidence_voids_withdraw_ops ON evidence_voids;
CREATE POLICY evidence_voids_withdraw_ops ON evidence_voids FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS sync_run_evidence_withdraw_ops ON sync_run_evidence;
CREATE POLICY sync_run_evidence_withdraw_ops ON sync_run_evidence FOR SELECT TO pactlab_ops USING (true);
DROP POLICY IF EXISTS finding_evidence_links_withdraw_ops ON finding_evidence_links;
CREATE POLICY finding_evidence_links_withdraw_ops ON finding_evidence_links FOR SELECT TO pactlab_ops USING (true);
DROP POLICY IF EXISTS valuation_runs_withdraw_ops ON valuation_runs;
CREATE POLICY valuation_runs_withdraw_ops ON valuation_runs FOR SELECT TO pactlab_ops USING (true);

-- Withdraw an import the caller uploaded. Null when it is not theirs, not in their pact, or not (still) imported.
-- Returns the records voided and the findings and valuation runs built on them, for the audit log.
CREATE OR REPLACE FUNCTION app_import_withdraw_own(p_upload uuid, p_reason text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_org uuid; v_deal uuid; v_run uuid; v_user uuid := app_current_user_id(); v_at timestamptz := now();
  v_voided integer; v_findings uuid[]; v_runs uuid[];
BEGIN
  SELECT organization_id, deal_id, sync_run_id INTO v_org, v_deal, v_run FROM source_uploads
   WHERE id = p_upload AND status = 'IMPORTED' AND uploaded_by = v_user
     AND organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids());
  IF v_org IS NULL OR v_run IS NULL OR length(btrim(coalesce(p_reason, ''))) < 3 THEN RETURN NULL; END IF;
  UPDATE source_uploads SET status = 'WITHDRAWN', withdrawn_at = v_at, withdrawn_by = v_user, withdrawal_reason = btrim(p_reason)
   WHERE id = p_upload AND status = 'IMPORTED';
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Records this run read that no other imported upload's run reads, seen across the whole pact.
  WITH orphaned AS (
    SELECT m.evidence_item_id AS id FROM sync_run_evidence m
     WHERE m.deal_id = v_deal AND m.sync_run_id = v_run
       AND NOT EXISTS (SELECT 1 FROM sync_run_evidence o JOIN source_uploads u ON u.deal_id = o.deal_id AND u.sync_run_id = o.sync_run_id
                        WHERE o.deal_id = m.deal_id AND o.evidence_item_id = m.evidence_item_id AND u.status = 'IMPORTED' AND u.id <> p_upload)
       AND NOT EXISTS (SELECT 1 FROM evidence_voids v WHERE v.evidence_item_id = m.evidence_item_id AND v.source_upload_id = p_upload)
  )
  INSERT INTO evidence_voids (id, organization_id, deal_id, evidence_item_id, source_upload_id, voided_at, voided_by)
  SELECT uuidv7(), v_org, v_deal, o.id, p_upload, v_at, v_user FROM orphaned o
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_voided = ROW_COUNT;
  SELECT array_agg(DISTINCT l.finding_id ORDER BY l.finding_id) INTO v_findings
    FROM finding_evidence_links l JOIN evidence_voids v ON v.evidence_item_id = l.evidence_item_id
   WHERE l.deal_id = v_deal AND v.source_upload_id = p_upload;
  IF v_findings IS NOT NULL THEN
    SELECT array_agg(r.id ORDER BY r.ran_at, r.id) INTO v_runs FROM valuation_runs r
     WHERE r.deal_id = v_deal AND r.ran_at <= v_at
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.inputs->'adjustments', '[]'::jsonb)) a WHERE a->>'findingId' = ANY (v_findings::text[]));
  END IF;
  RETURN jsonb_build_object('voided', v_voided, 'findingIds', COALESCE(to_jsonb(v_findings), '[]'::jsonb), 'valuationRunIds', COALESCE(to_jsonb(v_runs), '[]'::jsonb));
END
$$;
ALTER FUNCTION app_import_withdraw_own(uuid, text) OWNER TO pactlab_ops;
REVOKE ALL ON FUNCTION app_import_withdraw_own(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_import_withdraw_own(uuid, text) TO pactlab_app;
