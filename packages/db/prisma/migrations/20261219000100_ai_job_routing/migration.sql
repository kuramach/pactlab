-- Best-of-breed routing (T-132 PR 2): routes per job type (as well as the three aliases) in the admin
-- console, which lane answered each run (and what it fell back from), Hosting cost per job type, and
-- what the resolver and the per-pact cost ceiling read. Expand-only; re-runnable. Rollback: restore
-- the two check constraints and the three functions from 20261218000000 / 20261216000000, and drop
-- the new columns and functions.
BEGIN;

ALTER TABLE ai_platform_routes DROP CONSTRAINT IF EXISTS ai_platform_routes_alias;
ALTER TABLE ai_platform_routes ADD CONSTRAINT ai_platform_routes_alias CHECK ("alias" IN ('fast', 'balanced', 'deep_review', 'contract_scrub', 'extraction', 'classification', 'document_qa', 'vision'));
ALTER TABLE organization_ai_routes DROP CONSTRAINT IF EXISTS organization_ai_routes_alias;
ALTER TABLE organization_ai_routes ADD CONSTRAINT organization_ai_routes_alias CHECK ("alias" IN ('fast', 'balanced', 'deep_review', 'contract_scrub', 'extraction', 'classification', 'document_qa', 'vision'));

ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS "job_type" TEXT;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS "fallback_from" TEXT;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS "fallback_reason" TEXT;
-- Earlier runs: their job type from their task type (as the owner, with the forced policies lifted for this one update).
ALTER TABLE ai_runs NO FORCE ROW LEVEL SECURITY;
UPDATE ai_runs SET job_type = CASE task_type
    WHEN 'contract.extraction' THEN 'extraction'
    WHEN 'foresight.forecast' THEN 'extraction'
    WHEN 'document.classification' THEN 'classification'
    ELSE 'document_qa' END
 WHERE job_type IS NULL;
ALTER TABLE ai_runs FORCE ROW LEVEL SECURITY;

-- Routes per alias and per job type: the organization's, else the platform's; EVALUATED, cleared and
-- allowed models only. blocked (aliases only): the allow-list covers nothing for that alias. A job
-- type without a route of its own is never blocked here: its lane chain decides.
CREATE OR REPLACE FUNCTION app_ai_routes_for(p_org uuid)
  RETURNS TABLE (alias text, provider text, provider_model_id text, label text, blocked boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    WITH aliases(alias) AS (VALUES ('fast'), ('balanced'), ('deep_review'), ('contract_scrub'), ('extraction'), ('classification'), ('document_qa'), ('vision')),
    allowed AS (SELECT a.model_id FROM organization_ai_models a JOIN ai_models m ON m.id = a.model_id WHERE a.organization_id = p_org AND m.status = 'EVALUATED'),
    restricted AS (SELECT EXISTS (SELECT 1 FROM organization_ai_models a WHERE a.organization_id = p_org) AS on_list),
    usable AS (SELECT m.* FROM ai_models m, restricted r WHERE m.status = 'EVALUATED' AND app_ai_provider_cleared(m.provider) AND (NOT r.on_list OR m.id IN (SELECT model_id FROM allowed))),
    chosen AS (
      SELECT x.alias, coalesce(
               (SELECT u.id FROM organization_ai_routes o JOIN usable u ON u.id = o.model_id WHERE o.organization_id = p_org AND o.alias = x.alias),
               (SELECT u.id FROM ai_platform_routes p JOIN usable u ON u.id = p.model_id WHERE p.alias = x.alias)) AS model_id
        FROM aliases x
    )
    SELECT c.alias, m.provider, m.provider_model_id, m.label, (m.id IS NULL AND r.on_list AND c.alias IN ('fast', 'balanced', 'deep_review')) AS blocked
      FROM chosen c CROSS JOIN restricted r LEFT JOIN ai_models m ON m.id = c.model_id
     WHERE m.id IS NOT NULL OR (r.on_list AND c.alias IN ('fast', 'balanced', 'deep_review'))
  $$;

-- Whether a specific model may serve this organization: in the catalog, EVALUATED, its provider's
-- terms recorded, and on the organization's allow-list when it has one. The lane chain asks this.
CREATE OR REPLACE FUNCTION app_ai_model_usable(p_org uuid, p_provider text, p_model text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM ai_models m
       WHERE m.provider = p_provider AND m.provider_model_id = p_model AND m.status = 'EVALUATED' AND app_ai_provider_cleared(m.provider)
         AND (NOT EXISTS (SELECT 1 FROM organization_ai_models a WHERE a.organization_id = p_org)
              OR EXISTS (SELECT 1 FROM organization_ai_models a WHERE a.organization_id = p_org AND a.model_id = m.id)))
  $$;

-- A pact's metered AI spend so far (USD), for the per-pact cost ceiling: tokens x the rates on record.
CREATE OR REPLACE FUNCTION app_ai_deal_spend(p_org uuid, p_deal uuid) RETURNS numeric
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT coalesce(sum(
             coalesce(r.input_tokens::numeric / 1000000 * (SELECT c.unit_price FROM cost_rates c WHERE c.kind = 'BEDROCK_INPUT_PER_MTOK' AND c.key = r.resolved_model_id AND c.effective_from <= r.created_at::date ORDER BY c.effective_from DESC LIMIT 1), 0)
           + coalesce(r.output_tokens::numeric / 1000000 * (SELECT c.unit_price FROM cost_rates c WHERE c.kind = 'BEDROCK_OUTPUT_PER_MTOK' AND c.key = r.resolved_model_id AND c.effective_from <= r.created_at::date ORDER BY c.effective_from DESC LIMIT 1), 0)), 0)
      FROM ai_runs r WHERE r.organization_id = p_org AND r.deal_id = p_deal
  $$;

-- An organization's allow-list and routes: routes may now be per job type as well as per alias.
CREATE OR REPLACE FUNCTION app_ops_ai_org_models_set(p_actor uuid, p_org uuid, p_models uuid[], p_routes jsonb) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_alias text;
  v_model uuid;
BEGIN
  PERFORM app_ops_require(p_actor);
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p_org) THEN RETURN 'NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(p_models, ARRAY[]::uuid[])) x LEFT JOIN ai_models m ON m.id = x WHERE m.id IS NULL OR m.status <> 'EVALUATED') THEN RETURN 'NOT_EVALUATED'; END IF;
  FOR v_alias, v_model IN SELECT key, value::uuid FROM jsonb_each_text(coalesce(p_routes, '{}'::jsonb)) LOOP
    IF v_alias NOT IN ('fast', 'balanced', 'deep_review', 'contract_scrub', 'extraction', 'classification', 'document_qa', 'vision') THEN RETURN 'BAD_ALIAS'; END IF;
    IF NOT EXISTS (SELECT 1 FROM ai_models m WHERE m.id = v_model AND m.status = 'EVALUATED') THEN RETURN 'NOT_EVALUATED'; END IF;
    IF cardinality(coalesce(p_models, ARRAY[]::uuid[])) > 0 AND NOT v_model = ANY (p_models) THEN RETURN 'ROUTE_NOT_ALLOWED'; END IF;
  END LOOP;
  DELETE FROM organization_ai_models WHERE organization_id = p_org;
  DELETE FROM organization_ai_routes WHERE organization_id = p_org;
  INSERT INTO organization_ai_models (organization_id, model_id, created_by) SELECT p_org, x, p_actor FROM unnest(coalesce(p_models, ARRAY[]::uuid[])) x;
  INSERT INTO organization_ai_routes (organization_id, alias, model_id, updated_by)
  SELECT p_org, key, value::uuid, p_actor FROM jsonb_each_text(coalesce(p_routes, '{}'::jsonb));
  PERFORM app_ops_audit(p_actor, p_org, 'org.ai_models_set', 'organization', p_org);
  RETURN 'SAVED';
END
$$;

-- Clear a job type's platform route: the job then follows its lane chain. The three aliases always keep one.
CREATE OR REPLACE FUNCTION app_ops_ai_platform_route_clear(p_actor uuid, p_key text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE v_model uuid;
BEGIN
  PERFORM app_ops_require(p_actor);
  IF p_key IN ('fast', 'balanced', 'deep_review') THEN RETURN false; END IF;
  DELETE FROM ai_platform_routes WHERE alias = p_key RETURNING model_id INTO v_model;
  IF v_model IS NOT NULL THEN PERFORM app_ops_ai_audit(p_actor, 'operator.ai_route.cleared', v_model); END IF;
  RETURN true;
END
$$;

-- Hosting cost: the metered estimate per job type, and per pact and job type (AI only, like per model).
CREATE OR REPLACE FUNCTION app_ops_cost_metered_page(p_actor uuid, p_from date, p_to date, p_dimension text, p_after_total numeric, p_after_key text, p_limit integer)
  RETURNS TABLE (key text, label text, detail text, runs bigint, input_tokens bigint, output_tokens bigint, gb_months numeric, ai numeric, storage numeric, total numeric, total_rows bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  IF p_dimension NOT IN ('organization', 'pact', 'person', 'auth', 'model', 'job', 'pact_job') THEN RAISE EXCEPTION 'bad dimension' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
    WITH ai AS (
      SELECT (r.created_at AT TIME ZONE 'UTC')::date AS day, r.resolved_model_id AS model, r.organization_id, r.deal_id, r.requested_by, coalesce(r.job_type, 'unknown') AS job,
             count(*) AS n, sum(r.input_tokens)::bigint AS it, sum(r.output_tokens)::bigint AS ot
        FROM ai_runs r
       WHERE r.created_at >= p_from AND r.created_at < p_to
       GROUP BY 1, 2, 3, 4, 5, 6
    ), ai_priced AS (
      SELECT a.*, coalesce(a.it::numeric / 1000000 * ri.unit_price, 0) + coalesce(a.ot::numeric / 1000000 * ro.unit_price, 0) AS cost
        FROM ai a
        LEFT JOIN LATERAL (SELECT c.unit_price FROM cost_rates c WHERE c.kind = 'BEDROCK_INPUT_PER_MTOK' AND c.key = a.model AND c.effective_from <= a.day ORDER BY c.effective_from DESC LIMIT 1) ri ON true
        LEFT JOIN LATERAL (SELECT c.unit_price FROM cost_rates c WHERE c.kind = 'BEDROCK_OUTPUT_PER_MTOK' AND c.key = a.model AND c.effective_from <= a.day ORDER BY c.effective_from DESC LIMIT 1) ro ON true
    ), held AS (
      SELECT doc.organization_id, doc.deal_id, doc.uploaded_by AS requested_by,
             sum(doc.size_bytes::numeric * greatest(extract(epoch FROM (least(coalesce(doc.purged_at, now()), p_to::timestamptz, now()) - greatest(doc.created_at, p_from::timestamptz))), 0) / 86400) AS byte_days
        FROM documents doc
       WHERE doc.created_at < p_to AND (doc.purged_at IS NULL OR doc.purged_at >= p_from)
       GROUP BY 1, 2, 3
    ), storage_rate AS (
      SELECT c.unit_price FROM cost_rates c WHERE c.kind = 'S3_STORAGE_GB_MONTH' AND c.key = 'standard' AND c.effective_from <= (p_to - 1) ORDER BY c.effective_from DESC LIMIT 1
    ), held_priced AS (
      -- S3 bills GB-months; a byte held for 30 days is one byte-month here (an estimate).
      SELECT h.*, h.byte_days / 1073741824 / 30 AS gbm, coalesce(h.byte_days / 1073741824 / 30 * (SELECT s.unit_price FROM storage_rate s), 0) AS cost FROM held h
    ), keyed AS (
      SELECT CASE p_dimension WHEN 'organization' THEN a.organization_id::text WHEN 'pact' THEN a.deal_id::text WHEN 'person' THEN coalesce(a.requested_by::text, 'unknown')
                              WHEN 'auth' THEN (SELECT o.auth_method::text FROM organizations o WHERE o.id = a.organization_id) WHEN 'job' THEN a.job WHEN 'pact_job' THEN a.deal_id::text || '|' || a.job ELSE a.model END AS k,
             a.n AS n, a.it AS it, a.ot AS ot, 0::numeric AS gbm, a.cost AS ai_cost, 0::numeric AS storage_cost
        FROM ai_priced a
      UNION ALL
      SELECT CASE p_dimension WHEN 'organization' THEN h.organization_id::text WHEN 'pact' THEN h.deal_id::text WHEN 'person' THEN coalesce(h.requested_by::text, 'unknown')
                              ELSE (SELECT o.auth_method::text FROM organizations o WHERE o.id = h.organization_id) END,
             0, 0, 0, h.gbm, 0, h.cost
        FROM held_priced h
       WHERE p_dimension NOT IN ('model', 'job', 'pact_job')
    ), grouped AS (
      SELECT g.k, sum(g.n)::bigint AS n, sum(g.it)::bigint AS it, sum(g.ot)::bigint AS ot, sum(g.gbm) AS gbm, sum(g.ai_cost) AS ai_cost, sum(g.storage_cost) AS storage_cost,
             sum(g.ai_cost) + sum(g.storage_cost) AS total_cost
        FROM keyed g GROUP BY g.k
    ), page AS (
      SELECT x.* FROM grouped x
       WHERE p_after_key IS NULL OR (x.total_cost, x.k) < (p_after_total, p_after_key)
       ORDER BY x.total_cost DESC, x.k DESC
       LIMIT least(greatest(coalesce(p_limit, 51), 1), 101)
    )
    SELECT p.k,
           CASE p_dimension
             WHEN 'organization' THEN (SELECT o.name FROM organizations o WHERE o.id::text = p.k)
             WHEN 'pact' THEN (SELECT d.name FROM deals d WHERE d.id::text = p.k)
             WHEN 'person' THEN CASE WHEN p.k = 'unknown' THEN 'Before per-person tracking' ELSE coalesce((SELECT u.email FROM users u WHERE u.id::text = p.k), 'A removed user') END
             WHEN 'auth' THEN CASE p.k WHEN 'AUTH0' THEN 'Company SSO' WHEN 'EMAIL_CODE' THEN 'Email code' ELSE p.k END
             WHEN 'pact_job' THEN coalesce((SELECT d.name FROM deals d WHERE d.id::text = split_part(p.k, '|', 1)), 'A removed pact') || ' · ' || split_part(p.k, '|', 2)
             ELSE p.k END,
           CASE p_dimension
             WHEN 'organization' THEN (SELECT CASE o.auth_method::text WHEN 'AUTH0' THEN 'Company SSO' WHEN 'EMAIL_CODE' THEN 'Email code' ELSE o.auth_method::text END FROM organizations o WHERE o.id::text = p.k)
             WHEN 'pact' THEN (SELECT o.name FROM deals d JOIN organizations o ON o.id = d.organization_id WHERE d.id::text = p.k)
             ELSE NULL END,
           p.n, p.it, p.ot, p.gbm, p.ai_cost, p.storage_cost, p.total_cost, (SELECT count(*) FROM grouped)
      FROM page p
     ORDER BY p.total_cost DESC, p.k DESC;
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['app_ai_routes_for(uuid)', 'app_ai_model_usable(uuid, text, text)', 'app_ai_deal_spend(uuid, uuid)', 'app_ops_ai_org_models_set(uuid, uuid, uuid[], jsonb)', 'app_ops_ai_platform_route_clear(uuid, text)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;

COMMIT;
