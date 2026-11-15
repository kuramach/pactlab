-- Hosting cost (2026-11-15): real AWS spend from Cost Explorer (the payer account, every
-- environment), operator-entered rates, and metered usage by organization, pact and person.
-- Operator-only: the tables are reached through app_ops_* functions owned by pactlab_ops.
-- ai_runs gains requested_by (the person whose request made the run), filled from the tenant
-- context by default. Expand-only; rollback: drop the three tables, the functions and
-- ai_runs.requested_by. Re-runnable: Prisma does not wrap a migration in one transaction.
BEGIN;

ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS "requested_by" UUID DEFAULT app_current_user_id();

-- Spend as AWS bills it: one row per period, environment (the pactlab:environment tag) and AWS product.
CREATE TABLE IF NOT EXISTS "hosting_cost_lines" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "granularity" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "environment" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hosting_cost_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hosting_cost_lines_key" UNIQUE ("granularity", "period_start", "environment", "service"),
    CONSTRAINT "hosting_cost_lines_granularity_check" CHECK ("granularity" IN ('MONTHLY', 'DAILY')),
    CONSTRAINT "hosting_cost_lines_text_check" CHECK (char_length("environment") BETWEEN 1 AND 100 AND char_length("service") BETWEEN 1 AND 200 AND "currency" ~ '^[A-Z]{3}$')
);

-- Each refresh from Cost Explorer: when, by whom, and how it went (error class only).
CREATE TABLE IF NOT EXISTS "hosting_cost_syncs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "requested_by" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "lines" INTEGER NOT NULL DEFAULT 0,
    "error_class" TEXT,
    CONSTRAINT "hosting_cost_syncs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hosting_cost_syncs_status_check" CHECK ("status" IN ('SUCCEEDED', 'FAILED')),
    CONSTRAINT "hosting_cost_syncs_error_check" CHECK ("error_class" IS NULL OR char_length("error_class") <= 200)
);
CREATE INDEX IF NOT EXISTS "hosting_cost_syncs_started_idx" ON "hosting_cost_syncs"("started_at");

-- Unit prices an operator enters from AWS's price pages; never guessed. One per kind, key and start date.
CREATE TABLE IF NOT EXISTS "cost_rates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "unit_price" DECIMAL(18,8) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "effective_from" DATE NOT NULL,
    "source_note" TEXT NOT NULL DEFAULT '',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cost_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cost_rates_key" UNIQUE ("kind", "key", "effective_from"),
    CONSTRAINT "cost_rates_kind_check" CHECK ("kind" IN ('BEDROCK_INPUT_PER_MTOK', 'BEDROCK_OUTPUT_PER_MTOK', 'S3_STORAGE_GB_MONTH')),
    CONSTRAINT "cost_rates_price_check" CHECK ("unit_price" >= 0),
    CONSTRAINT "cost_rates_text_check" CHECK (char_length("key") BETWEEN 1 AND 200 AND char_length("source_note") <= 500 AND "currency" ~ '^[A-Z]{3}$')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON hosting_cost_lines, hosting_cost_syncs, cost_rates TO pactlab_ops;
GRANT SELECT (id, organization_id, deal_id, size_bytes, uploaded_by, created_at, purged_at, status) ON documents TO pactlab_ops;
ALTER TABLE hosting_cost_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosting_cost_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE hosting_cost_syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosting_cost_syncs FORCE ROW LEVEL SECURITY;
ALTER TABLE cost_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_rates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hosting_cost_lines_ops ON hosting_cost_lines;
CREATE POLICY hosting_cost_lines_ops ON hosting_cost_lines FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hosting_cost_syncs_ops ON hosting_cost_syncs;
CREATE POLICY hosting_cost_syncs_ops ON hosting_cost_syncs FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cost_rates_ops ON cost_rates;
CREATE POLICY cost_rates_ops ON cost_rates FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS documents_ops_cost ON documents;
CREATE POLICY documents_ops_cost ON documents FOR SELECT TO pactlab_ops USING (true);

-- Platform-wide operator actions are audited under the operator's own organization.
CREATE OR REPLACE FUNCTION app_ops_cost_audit(p_actor uuid, p_action text, p_target_type text, p_target uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_org uuid;
BEGIN
  IF p_actor IS NULL THEN RETURN; END IF;
  SELECT m.organization_id INTO v_org FROM organization_memberships m WHERE m.user_id = p_actor ORDER BY m.created_at, m.id LIMIT 1;
  IF v_org IS NULL THEN RETURN; END IF;
  PERFORM app_ops_audit(p_actor, v_org, p_action, p_target_type, p_target);
END
$$;

-- Replace one window of Cost Explorer lines in one go (a refresh never duplicates), and log it.
CREATE OR REPLACE FUNCTION app_ops_cost_replace(p_actor uuid, p_granularity text, p_from date, p_to date, p_lines jsonb) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM app_ops_require(p_actor);
  DELETE FROM hosting_cost_lines WHERE granularity = p_granularity AND period_start >= p_from AND period_start < p_to;
  INSERT INTO hosting_cost_lines (granularity, period_start, environment, service, amount, currency, estimated)
  SELECT p_granularity, l.period_start, l.environment, l.service, sum(l.amount), l.currency, bool_or(l.estimated)
    FROM jsonb_to_recordset(p_lines) AS l(period_start date, environment text, service text, amount numeric, currency text, estimated boolean)
   WHERE l.period_start >= p_from AND l.period_start < p_to
   GROUP BY l.period_start, l.environment, l.service, l.currency;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION app_ops_cost_sync_log(p_actor uuid, p_status text, p_lines integer, p_error text, p_at timestamptz) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  INSERT INTO hosting_cost_syncs (requested_by, started_at, status, lines, error_class) VALUES (p_actor, coalesce(p_at, now()), p_status, p_lines, left(p_error, 200));
  PERFORM app_ops_cost_audit(p_actor, CASE WHEN p_status = 'SUCCEEDED' THEN 'operator.cost_refreshed' ELSE 'operator.cost_refresh_failed' END, 'hosting_cost', NULL);
END
$$;

-- The last refresh attempt and the last one that worked.
CREATE OR REPLACE FUNCTION app_ops_cost_sync_state(p_actor uuid)
  RETURNS TABLE (last_attempt_at timestamptz, last_status text, last_error text, last_success_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT (SELECT s.started_at::timestamptz FROM hosting_cost_syncs s ORDER BY s.started_at DESC LIMIT 1),
           (SELECT s.status FROM hosting_cost_syncs s ORDER BY s.started_at DESC LIMIT 1),
           (SELECT s.error_class FROM hosting_cost_syncs s ORDER BY s.started_at DESC LIMIT 1),
           (SELECT s.started_at::timestamptz FROM hosting_cost_syncs s WHERE s.status = 'SUCCEEDED' ORDER BY s.started_at DESC LIMIT 1);
END
$$;

CREATE OR REPLACE FUNCTION app_ops_cost_lines(p_actor uuid, p_granularity text, p_from date, p_to date)
  RETURNS TABLE (period_start date, environment text, service text, amount numeric, currency text, estimated boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT l.period_start, l.environment, l.service, l.amount, l.currency::text, l.estimated FROM hosting_cost_lines l
     WHERE l.granularity = p_granularity AND l.period_start >= p_from AND l.period_start < p_to
     ORDER BY l.period_start, l.environment, l.service;
END
$$;

CREATE OR REPLACE FUNCTION app_ops_cost_rates(p_actor uuid)
  RETURNS TABLE (id uuid, kind text, key text, unit_price numeric, currency text, effective_from date, source_note text, created_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY SELECT r.id, r.kind, r.key, r.unit_price, r.currency::text, r.effective_from, r.source_note, r.created_at::timestamptz FROM cost_rates r ORDER BY r.kind, r.key, r.effective_from;
END
$$;

-- Set a rate from a date (a later date starts a new rate; the same date corrects it). Audited.
CREATE OR REPLACE FUNCTION app_ops_cost_rate_set(p_actor uuid, p_kind text, p_key text, p_price numeric, p_currency text, p_from date, p_note text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM app_ops_require(p_actor);
  INSERT INTO cost_rates (kind, key, unit_price, currency, effective_from, source_note, created_by)
  VALUES (p_kind, btrim(p_key), p_price, p_currency, p_from, btrim(coalesce(p_note, '')), p_actor)
  ON CONFLICT (kind, key, effective_from) DO UPDATE SET unit_price = excluded.unit_price, currency = excluded.currency, source_note = excluded.source_note, created_by = excluded.created_by, created_at = now()
  RETURNING cost_rates.id INTO v_id;
  PERFORM app_ops_cost_audit(p_actor, 'operator.cost_rate_set', 'cost_rate', v_id);
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION app_ops_cost_rate_delete(p_actor uuid, p_rate uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM app_ops_require(p_actor);
  DELETE FROM cost_rates WHERE id = p_rate;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 1 THEN PERFORM app_ops_cost_audit(p_actor, 'operator.cost_rate_deleted', 'cost_rate', p_rate); END IF;
  RETURN v_count = 1;
END
$$;

-- Metered AI usage in [p_from, p_to): tokens by day, model, organization, pact and person. Counts only.
CREATE OR REPLACE FUNCTION app_ops_cost_ai_usage(p_actor uuid, p_from date, p_to date)
  RETURNS TABLE (day date, model_id text, organization_id uuid, organization_name text, auth_method text, deal_id uuid, deal_name text,
                 user_id uuid, user_email text, runs bigint, input_tokens bigint, output_tokens bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT (r.created_at AT TIME ZONE 'UTC')::date, r.resolved_model_id, o.id, o.name, o.auth_method::text, d.id, d.name,
           r.requested_by, u.email, count(*), sum(r.input_tokens)::bigint, sum(r.output_tokens)::bigint
      FROM ai_runs r
      JOIN organizations o ON o.id = r.organization_id
      JOIN deals d ON d.id = r.deal_id
      LEFT JOIN users u ON u.id = r.requested_by
     WHERE r.created_at >= p_from AND r.created_at < p_to
     GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9;
END
$$;

-- Metered document storage in [p_from, p_to): byte-days held, by organization, pact and uploader.
CREATE OR REPLACE FUNCTION app_ops_cost_storage_usage(p_actor uuid, p_from date, p_to date)
  RETURNS TABLE (organization_id uuid, organization_name text, auth_method text, deal_id uuid, deal_name text,
                 user_id uuid, user_email text, documents bigint, byte_days numeric)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    WITH held AS (
      SELECT doc.organization_id, doc.deal_id, doc.uploaded_by, doc.size_bytes::numeric AS bytes,
             greatest(doc.created_at, p_from::timestamptz) AS held_from,
             least(coalesce(doc.purged_at, now()), p_to::timestamptz, now()) AS held_to
        FROM documents doc
       WHERE doc.created_at < p_to AND (doc.purged_at IS NULL OR doc.purged_at >= p_from)
    )
    SELECT o.id, o.name, o.auth_method::text, d.id, d.name, h.uploaded_by, u.email, count(*),
           sum(h.bytes * greatest(extract(epoch FROM (h.held_to - h.held_from)), 0) / 86400)
      FROM held h
      JOIN organizations o ON o.id = h.organization_id
      JOIN deals d ON d.id = h.deal_id
      LEFT JOIN users u ON u.id = h.uploaded_by
     GROUP BY 1, 2, 3, 4, 5, 6, 7;
END
$$;

-- The audit helper is called only from the functions above, never by the app.
ALTER FUNCTION app_ops_cost_audit(uuid, text, text, uuid) OWNER TO pactlab_ops;
REVOKE ALL ON FUNCTION app_ops_cost_audit(uuid, text, text, uuid) FROM PUBLIC;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_ops_cost_replace(uuid, text, date, date, jsonb)', 'app_ops_cost_sync_log(uuid, text, integer, text, timestamptz)', 'app_ops_cost_sync_state(uuid)',
    'app_ops_cost_lines(uuid, text, date, date)', 'app_ops_cost_rates(uuid)', 'app_ops_cost_rate_set(uuid, text, text, numeric, text, date, text)',
    'app_ops_cost_rate_delete(uuid, uuid)', 'app_ops_cost_ai_usage(uuid, date, date)', 'app_ops_cost_storage_usage(uuid, date, date)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;

COMMIT;
