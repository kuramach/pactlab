-- Other clouds (T-131 PR 2, ADR 0029): a provider outside AWS serves only after an operator records
-- its data terms: a data-processing agreement in place and no retention or training on our
-- requests. Until then its models can be neither evaluated nor served. Bedrock (inside our AWS
-- accounts) and the test fixture need no record. Expand-only; re-runnable. Rollback: drop the
-- table and app_ai_provider_cleared, and restore the two functions from 20261218000000_ai_models.
BEGIN;

CREATE TABLE IF NOT EXISTS "ai_provider_terms" (
    "provider" TEXT NOT NULL,
    "dpa_in_place" BOOLEAN NOT NULL,
    "zero_retention" BOOLEAN NOT NULL,
    "region" TEXT,
    "notes" TEXT,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_provider_terms_pkey" PRIMARY KEY ("provider"),
    CONSTRAINT "ai_provider_terms_provider" CHECK ("provider" IN ('openai', 'google')),
    CONSTRAINT "ai_provider_terms_notes" CHECK ("notes" IS NULL OR char_length("notes") <= 1000),
    CONSTRAINT "ai_provider_terms_region" CHECK ("region" IS NULL OR char_length("region") <= 80)
);
ALTER TABLE ai_provider_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_terms FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON ai_provider_terms TO pactlab_ops;
DROP POLICY IF EXISTS ai_provider_terms_ops ON ai_provider_terms;
CREATE POLICY ai_provider_terms_ops ON ai_provider_terms FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);

-- True when the provider may be evaluated and serve: Bedrock and the fixture always; others with both terms recorded.
CREATE OR REPLACE FUNCTION app_ai_provider_cleared(p_provider text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT p_provider IN ('bedrock', 'fixture')
        OR EXISTS (SELECT 1 FROM ai_provider_terms t WHERE t.provider = p_provider AND t.dpa_in_place AND t.zero_retention)
  $$;

-- Routes: as before, and only models whose provider is cleared (terms withdrawn stop a provider at once).
CREATE OR REPLACE FUNCTION app_ai_routes_for(p_org uuid)
  RETURNS TABLE (alias text, provider text, provider_model_id text, label text, blocked boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    WITH aliases(alias) AS (VALUES ('fast'), ('balanced'), ('deep_review')),
    allowed AS (SELECT a.model_id FROM organization_ai_models a JOIN ai_models m ON m.id = a.model_id WHERE a.organization_id = p_org AND m.status = 'EVALUATED'),
    restricted AS (SELECT EXISTS (SELECT 1 FROM organization_ai_models a WHERE a.organization_id = p_org) AS on_list),
    usable AS (SELECT m.* FROM ai_models m, restricted r WHERE m.status = 'EVALUATED' AND app_ai_provider_cleared(m.provider) AND (NOT r.on_list OR m.id IN (SELECT model_id FROM allowed))),
    chosen AS (
      SELECT x.alias, coalesce(
               (SELECT u.id FROM organization_ai_routes o JOIN usable u ON u.id = o.model_id WHERE o.organization_id = p_org AND o.alias = x.alias),
               (SELECT u.id FROM ai_platform_routes p JOIN usable u ON u.id = p.model_id WHERE p.alias = x.alias)) AS model_id
        FROM aliases x
    )
    SELECT c.alias, m.provider, m.provider_model_id, m.label, (m.id IS NULL AND r.on_list) AS blocked
      FROM chosen c CROSS JOIN restricted r LEFT JOIN ai_models m ON m.id = c.model_id
     WHERE m.id IS NOT NULL OR r.on_list
  $$;

-- An evaluation starts only for a cleared provider: no synthetic test material reaches a provider whose terms are not on record.
CREATE OR REPLACE FUNCTION app_ops_ai_model_evaluating(p_actor uuid, p_model uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  UPDATE ai_models SET evaluating_since = now(), updated_at = now()
   WHERE id = p_model AND status <> 'RETIRED' AND app_ai_provider_cleared(provider)
     AND (evaluating_since IS NULL OR evaluating_since < now() - interval '30 minutes');
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM app_ops_ai_audit(p_actor, 'operator.ai_model.evaluation_started', p_model);
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION app_ops_ai_provider_terms(p_actor uuid)
  RETURNS TABLE (provider text, dpa_in_place boolean, zero_retention boolean, region text, notes text, recorded_at timestamptz, recorded_by_name text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT t.provider, t.dpa_in_place, t.zero_retention, t.region, t.notes, t.recorded_at::timestamptz, u.display_name
      FROM ai_provider_terms t LEFT JOIN users u ON u.id = t.recorded_by ORDER BY t.provider;
END
$$;

CREATE OR REPLACE FUNCTION app_ops_ai_provider_terms_set(p_actor uuid, p_provider text, p_dpa boolean, p_zero_retention boolean, p_region text, p_notes text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE v_target uuid := uuidv7();
BEGIN
  PERFORM app_ops_require(p_actor);
  INSERT INTO ai_provider_terms (provider, dpa_in_place, zero_retention, region, notes, recorded_by, recorded_at)
  VALUES (p_provider, p_dpa, p_zero_retention, nullif(btrim(p_region), ''), nullif(btrim(p_notes), ''), p_actor, now())
  ON CONFLICT (provider) DO UPDATE SET dpa_in_place = EXCLUDED.dpa_in_place, zero_retention = EXCLUDED.zero_retention, region = EXCLUDED.region,
                                       notes = EXCLUDED.notes, recorded_by = EXCLUDED.recorded_by, recorded_at = now();
  INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
  SELECT uuidv7(), m.organization_id, NULL, p_actor,
         CASE WHEN p_dpa AND p_zero_retention THEN 'operator.ai_provider.cleared' ELSE 'operator.ai_provider.not_cleared' END, 'ai_provider', p_provider, 'SUCCEEDED'
    FROM organization_memberships m WHERE m.user_id = p_actor AND m.status = 'ACTIVE' ORDER BY m.organization_id LIMIT 1;
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['app_ai_provider_cleared(text)', 'app_ai_routes_for(uuid)', 'app_ops_ai_model_evaluating(uuid, uuid)', 'app_ops_ai_provider_terms(uuid)',
                            'app_ops_ai_provider_terms_set(uuid, text, boolean, boolean, text, text)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;

COMMIT;
