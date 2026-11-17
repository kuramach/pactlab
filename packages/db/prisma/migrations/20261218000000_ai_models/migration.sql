-- AI models managed in the admin console (T-130): a catalog of models across providers, an
-- evaluation gate (only EVALUATED models serve), platform default routes per alias, and a
-- per-organization allow-list with its own routes. Expand-only; re-runnable. Rollback: drop the
-- four tables and the functions, and ai_runs.resolved_provider; the API then serves the routes
-- from its configuration, as before.
BEGIN;

CREATE TABLE IF NOT EXISTS "ai_models" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_model_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ADDED',
    "evaluation" JSONB,
    "evaluating_since" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_models_provider" CHECK ("provider" IN ('bedrock', 'openai', 'google', 'fixture')),
    CONSTRAINT "ai_models_status" CHECK ("status" IN ('ADDED', 'EVALUATED', 'RETIRED')),
    CONSTRAINT "ai_models_model_id" CHECK ("provider_model_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{1,199}$'),
    CONSTRAINT "ai_models_label" CHECK (char_length(btrim("label")) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_models_provider_model_key" ON "ai_models"("provider", "provider_model_id");

CREATE TABLE IF NOT EXISTS "ai_platform_routes" (
    "alias" TEXT NOT NULL,
    "model_id" UUID NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_platform_routes_pkey" PRIMARY KEY ("alias"),
    CONSTRAINT "ai_platform_routes_alias" CHECK ("alias" IN ('fast', 'balanced', 'deep_review')),
    CONSTRAINT "ai_platform_routes_model_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "organization_ai_models" (
    "organization_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_ai_models_pkey" PRIMARY KEY ("organization_id", "model_id"),
    CONSTRAINT "organization_ai_models_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
    CONSTRAINT "organization_ai_models_model_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "organization_ai_routes" (
    "organization_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "model_id" UUID NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_ai_routes_pkey" PRIMARY KEY ("organization_id", "alias"),
    CONSTRAINT "organization_ai_routes_alias" CHECK ("alias" IN ('fast', 'balanced', 'deep_review')),
    CONSTRAINT "organization_ai_routes_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
    CONSTRAINT "organization_ai_routes_model_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT
);

-- Which provider answered (the model id alone no longer says): bedrock for every run before T-130.
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS "resolved_provider" TEXT NOT NULL DEFAULT 'bedrock';

ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_models FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_platform_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform_routes FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_ai_models FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_ai_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_ai_routes FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_models, ai_platform_routes, organization_ai_models, organization_ai_routes TO pactlab_ops;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_models', 'ai_platform_routes', 'organization_ai_models', 'organization_ai_routes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_ops', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO pactlab_ops USING (true) WITH CHECK (true)', t || '_ops', t);
  END LOOP;
END
$$;

-- Audited under the operator's own organization, as promo codes are; 'operator.' so the console's audit view lists them.
CREATE OR REPLACE FUNCTION app_ops_ai_audit(p_actor uuid, p_action text, p_target uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
    SELECT uuidv7(), m.organization_id, NULL, p_actor, p_action, 'ai_model', p_target::text, 'SUCCEEDED'
      FROM organization_memberships m WHERE m.user_id = p_actor AND m.status = 'ACTIVE' ORDER BY m.organization_id LIMIT 1
  $$;

-- The model each alias resolves to for an organization, for every call (cached by the API):
-- the organization's route, else the platform route; only EVALUATED models, and only models on
-- the organization's allow-list when it has one. blocked: the allow-list covers no model for the
-- alias (the call is refused, never sent to an excluded model). No row: the code default serves.
CREATE OR REPLACE FUNCTION app_ai_routes_for(p_org uuid)
  RETURNS TABLE (alias text, provider text, provider_model_id text, label text, blocked boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    WITH aliases(alias) AS (VALUES ('fast'), ('balanced'), ('deep_review')),
    allowed AS (SELECT a.model_id FROM organization_ai_models a JOIN ai_models m ON m.id = a.model_id WHERE a.organization_id = p_org AND m.status = 'EVALUATED'),
    restricted AS (SELECT EXISTS (SELECT 1 FROM organization_ai_models a WHERE a.organization_id = p_org) AS on_list),
    usable AS (SELECT m.* FROM ai_models m, restricted r WHERE m.status = 'EVALUATED' AND (NOT r.on_list OR m.id IN (SELECT model_id FROM allowed))),
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

-- At boot the API adopts the models it is configured with into an empty catalog, so nothing changes on
-- deploy: each becomes EVALUATED (it is what serves today) and the platform route where none is set.
CREATE OR REPLACE FUNCTION app_ai_adopt_routes(p_routes jsonb) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_route jsonb;
  v_model uuid;
  v_added integer := 0;
BEGIN
  FOR v_route IN SELECT * FROM jsonb_array_elements(p_routes) LOOP
    IF v_route->>'alias' NOT IN ('fast', 'balanced', 'deep_review') OR EXISTS (SELECT 1 FROM ai_platform_routes p WHERE p.alias = v_route->>'alias') THEN
      CONTINUE;
    END IF;
    INSERT INTO ai_models (id, provider, provider_model_id, label, status, evaluation)
    VALUES (uuidv7(), v_route->>'provider', v_route->>'modelId', v_route->>'label', 'EVALUATED', jsonb_build_object('basis', 'Serving before T-130 (adopted from the deployment)', 'adoptedAt', now()))
    ON CONFLICT (provider, provider_model_id) DO NOTHING;
    SELECT m.id INTO v_model FROM ai_models m WHERE m.provider = v_route->>'provider' AND m.provider_model_id = v_route->>'modelId';
    INSERT INTO ai_platform_routes (alias, model_id) VALUES (v_route->>'alias', v_model) ON CONFLICT (alias) DO NOTHING;
    v_added := v_added + 1;
  END LOOP;
  RETURN v_added;
END
$$;

-- Operators ------------------------------------------------------------------------------------

-- The catalog (bounded: tens of models), each with how many organizations allow it and the aliases it serves platform-wide.
CREATE OR REPLACE FUNCTION app_ops_ai_models(p_actor uuid)
  RETURNS TABLE (id uuid, provider text, provider_model_id text, label text, status text, evaluation jsonb, evaluating_since timestamptz,
                 created_at timestamptz, organizations bigint, platform_aliases text[])
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT m.id, m.provider, m.provider_model_id, m.label, m.status, m.evaluation, m.evaluating_since::timestamptz, m.created_at::timestamptz,
           (SELECT count(*) FROM organization_ai_models a WHERE a.model_id = m.id),
           ARRAY(SELECT p.alias FROM ai_platform_routes p WHERE p.model_id = m.id ORDER BY p.alias)
      FROM ai_models m
     ORDER BY (m.status = 'RETIRED'), m.provider, m.label
     LIMIT 500;
END
$$;

CREATE OR REPLACE FUNCTION app_ops_ai_model_add(p_actor uuid, p_provider text, p_model_id text, p_label text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE v_id uuid := uuidv7();
BEGIN
  PERFORM app_ops_require(p_actor);
  INSERT INTO ai_models (id, provider, provider_model_id, label, created_by) VALUES (v_id, p_provider, btrim(p_model_id), btrim(p_label), p_actor);
  PERFORM app_ops_ai_audit(p_actor, 'operator.ai_model.added', v_id);
  RETURN v_id;
END
$$;

-- An evaluation starts (the worker runs it). False when the model is retired or already being evaluated (under 30 minutes).
CREATE OR REPLACE FUNCTION app_ops_ai_model_evaluating(p_actor uuid, p_model uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  UPDATE ai_models SET evaluating_since = now(), updated_at = now()
   WHERE id = p_model AND status <> 'RETIRED' AND (evaluating_since IS NULL OR evaluating_since < now() - interval '30 minutes');
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM app_ops_ai_audit(p_actor, 'operator.ai_model.evaluation_started', p_model);
  RETURN true;
END
$$;

-- The evaluation's result: a pass makes the model EVALUATED; a fail leaves it as it was (an evaluated model stays serving).
CREATE OR REPLACE FUNCTION app_ops_ai_model_evaluated(p_actor uuid, p_model uuid, p_passed boolean, p_evaluation jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  UPDATE ai_models
     SET evaluation = p_evaluation, evaluating_since = NULL, updated_at = now(),
         status = CASE WHEN p_passed AND status <> 'RETIRED' THEN 'EVALUATED' ELSE status END
   WHERE id = p_model;
  PERFORM app_ops_ai_audit(p_actor, CASE WHEN p_passed THEN 'operator.ai_model.evaluation_passed' ELSE 'operator.ai_model.evaluation_failed' END, p_model);
END
$$;

-- Retire: refused while a platform route uses it. Organization routes to it stop resolving at once.
CREATE OR REPLACE FUNCTION app_ops_ai_model_retire(p_actor uuid, p_model uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  IF EXISTS (SELECT 1 FROM ai_platform_routes p WHERE p.model_id = p_model) THEN RETURN 'IN_USE'; END IF;
  UPDATE ai_models SET status = 'RETIRED', updated_at = now() WHERE id = p_model AND status <> 'RETIRED';
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  PERFORM app_ops_ai_audit(p_actor, 'operator.ai_model.retired', p_model);
  RETURN 'RETIRED';
END
$$;

-- The platform default for an alias: an EVALUATED model only. False otherwise.
CREATE OR REPLACE FUNCTION app_ops_ai_platform_route_set(p_actor uuid, p_alias text, p_model uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  IF NOT EXISTS (SELECT 1 FROM ai_models m WHERE m.id = p_model AND m.status = 'EVALUATED') THEN RETURN false; END IF;
  INSERT INTO ai_platform_routes (alias, model_id, updated_by, updated_at) VALUES (p_alias, p_model, p_actor, now())
  ON CONFLICT (alias) DO UPDATE SET model_id = EXCLUDED.model_id, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM app_ops_ai_audit(p_actor, 'operator.ai_route.set', p_model);
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION app_ops_ai_org_models(p_actor uuid, p_org uuid)
  RETURNS TABLE (kind text, alias text, model_id uuid)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT 'ALLOWED'::text, NULL::text, a.model_id FROM organization_ai_models a WHERE a.organization_id = p_org
    UNION ALL
    SELECT 'ROUTE'::text, r.alias, r.model_id FROM organization_ai_routes r WHERE r.organization_id = p_org;
END
$$;

-- An organization's allow-list (empty: the platform defaults) and its routes ({"fast": "<model id>", ...}),
-- replaced together. Every model must be EVALUATED; every route's model on the list when there is one.
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
    IF v_alias NOT IN ('fast', 'balanced', 'deep_review') THEN RETURN 'BAD_ALIAS'; END IF;
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

-- The audit helper is internal: owned by pactlab_ops, callable only from the functions above.
ALTER FUNCTION app_ops_ai_audit(uuid, text, uuid) OWNER TO pactlab_ops;
REVOKE ALL ON FUNCTION app_ops_ai_audit(uuid, text, uuid) FROM PUBLIC;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_ai_routes_for(uuid)', 'app_ai_adopt_routes(jsonb)', 'app_ops_ai_models(uuid)',
    'app_ops_ai_model_add(uuid, text, text, text)', 'app_ops_ai_model_evaluating(uuid, uuid)', 'app_ops_ai_model_evaluated(uuid, uuid, boolean, jsonb)',
    'app_ops_ai_model_retire(uuid, uuid)', 'app_ops_ai_platform_route_set(uuid, text, uuid)', 'app_ops_ai_org_models(uuid, uuid)',
    'app_ops_ai_org_models_set(uuid, uuid, uuid[], jsonb)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;

COMMIT;
