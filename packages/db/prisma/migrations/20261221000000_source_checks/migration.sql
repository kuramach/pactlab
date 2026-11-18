-- Live checks its own public data sources (IMF World Economic Outlook first): live is what uses the
-- data, so live is where reachability is checked (T-137 follow-up). Platform-level rows, no tenant
-- data. Expand-only; re-runnable. Rollback: drop the three functions and the table.
BEGIN;

CREATE TABLE IF NOT EXISTS "external_source_status" (
    "source" TEXT NOT NULL,
    -- NULL until the first check finishes.
    "status" TEXT,
    "checked_at" TIMESTAMPTZ,
    -- When a check last started: one check at a time across API tasks, at most one per interval.
    "claimed_at" TIMESTAMPTZ,
    "last_ok_at" TIMESTAMPTZ,
    "failing_since" TIMESTAMPTZ,
    -- What came back (e.g. "403 text/html"); never a response body.
    "detail" TEXT,
    CONSTRAINT "external_source_status_pkey" PRIMARY KEY ("source"),
    CONSTRAINT "external_source_status_source_check" CHECK ("source" ~ '^[a-z][a-z0-9-]{1,40}$'),
    CONSTRAINT "external_source_status_status_check" CHECK ("status" IS NULL OR "status" IN ('OK', 'FAILING')),
    CONSTRAINT "external_source_status_detail_check" CHECK ("detail" IS NULL OR length("detail") <= 200)
);
ALTER TABLE external_source_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_source_status FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON external_source_status TO pactlab_ops;
DROP POLICY IF EXISTS external_source_status_ops ON external_source_status;
CREATE POLICY external_source_status_ops ON external_source_status FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);

-- Claim the next check of a source: true when none ran within the interval (or the last one stalled),
-- atomically, so several API tasks never check at once.
CREATE OR REPLACE FUNCTION app_source_check_claim(p_source text, p_interval_minutes integer) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE v_claimed boolean;
BEGIN
  INSERT INTO external_source_status (source) VALUES (p_source) ON CONFLICT (source) DO NOTHING;
  UPDATE external_source_status SET claimed_at = now()
   WHERE source = p_source
     AND (claimed_at IS NULL OR claimed_at <= now() - make_interval(mins => greatest(p_interval_minutes, 0)))
  RETURNING true INTO v_claimed;
  RETURN coalesce(v_claimed, false);
END
$$;

-- Record a finished check; returns the status before it (NULL on the first), so the caller alerts on a change only.
CREATE OR REPLACE FUNCTION app_source_check_record(p_source text, p_ok boolean, p_detail text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE v_before text;
BEGIN
  SELECT status INTO v_before FROM external_source_status WHERE source = p_source FOR UPDATE;
  INSERT INTO external_source_status (source) VALUES (p_source) ON CONFLICT (source) DO NOTHING;
  UPDATE external_source_status
     SET status = CASE WHEN p_ok THEN 'OK' ELSE 'FAILING' END,
         checked_at = now(),
         last_ok_at = CASE WHEN p_ok THEN now() ELSE last_ok_at END,
         failing_since = CASE WHEN p_ok THEN NULL WHEN status = 'FAILING' THEN failing_since ELSE now() END,
         detail = CASE WHEN p_ok THEN NULL ELSE left(p_detail, 200) END
   WHERE source = p_source;
  RETURN v_before;
END
$$;

-- The console's view (Admin → Health): one row per source, so a bounded list.
CREATE OR REPLACE FUNCTION app_ops_source_status(p_actor uuid)
  RETURNS TABLE (source text, status text, checked_at timestamptz, last_ok_at timestamptz, failing_since timestamptz, detail text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY SELECT s.source, s.status, s.checked_at, s.last_ok_at, s.failing_since, s.detail FROM external_source_status s ORDER BY s.source;
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['app_source_check_claim(text, integer)', 'app_source_check_record(text, boolean, text)', 'app_ops_source_status(uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;

COMMIT;
