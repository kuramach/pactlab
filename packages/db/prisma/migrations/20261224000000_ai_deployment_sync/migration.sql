-- A deploy's Claude models go live on their own (Kumar, 2026-11-20). Boot adoption only filled an empty
-- catalog, so a deploy that changed the configured models changed nothing once routes existed; and a
-- failed evaluation never took a model out of service. Now: the API syncs the configured models at boot
-- (added, then evaluated by the same gate, then switched in where the platform route still follows the
-- deployment, never over an operator's choice), and a failed evaluation stops a model serving.
-- Expand-only; re-runnable. Rollback: drop the column and the new functions; restore the two replaced
-- functions from 20261218000000.
BEGIN;

ALTER TABLE ai_platform_routes ADD COLUMN IF NOT EXISTS "follows_deployment" BOOLEAN NOT NULL DEFAULT false;
-- Routes adopted at boot were never set by a person (no updated_by): they follow the deployment.
ALTER TABLE ai_platform_routes NO FORCE ROW LEVEL SECURITY;
UPDATE ai_platform_routes SET follows_deployment = true WHERE updated_by IS NULL AND NOT follows_deployment;
ALTER TABLE ai_platform_routes FORCE ROW LEVEL SECURITY;

-- System actions (no person) are audited under the platform operators' organization, as 'operator.'
-- so the console's audit view lists them. Skipped when no operator exists yet.
CREATE OR REPLACE FUNCTION app_ai_system_audit(p_action text, p_target uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
    SELECT uuidv7(), m.organization_id, NULL, NULL, p_action, 'ai_model', p_target::text, 'SUCCEEDED'
      FROM organization_memberships m JOIN users u ON u.id = m.user_id
     WHERE u.platform_operator AND m.status = 'ACTIVE'
     ORDER BY m.organization_id LIMIT 1
  $$;

-- At boot: the deployment's configured model per role. On an empty catalog, adopted as serving (as before).
-- Otherwise a new model is added (not serving) for the evaluation; an already-evaluated one is switched in
-- at once where the route follows the deployment. Returns the configured models still to be evaluated.
DROP FUNCTION IF EXISTS app_ai_deployment_sync(jsonb);
CREATE FUNCTION app_ai_deployment_sync(p_routes jsonb) RETURNS TABLE (model_id uuid, provider text, provider_model_id text, label text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_route jsonb;
  v_model uuid;
  v_status text;
  v_route_model uuid;
  v_follows boolean;
  v_pending uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR v_route IN SELECT * FROM jsonb_array_elements(p_routes) LOOP
    IF v_route->>'alias' NOT IN ('fast', 'balanced', 'deep_review') THEN CONTINUE; END IF;
    SELECT p.model_id, p.follows_deployment INTO v_route_model, v_follows FROM ai_platform_routes p WHERE p.alias = v_route->>'alias';
    INSERT INTO ai_models (id, provider, provider_model_id, label, status, evaluation)
    VALUES (uuidv7(), v_route->>'provider', v_route->>'modelId', v_route->>'label',
            CASE WHEN v_route_model IS NULL THEN 'EVALUATED' ELSE 'ADDED' END,
            CASE WHEN v_route_model IS NULL THEN jsonb_build_object('basis', 'Serving before T-131 (adopted from the deployment)', 'adoptedAt', now())
                 ELSE jsonb_build_object('basis', 'Configured for this deployment', 'configuredAt', now()) END)
    ON CONFLICT (provider, provider_model_id) DO NOTHING;
    SELECT m.id, m.status INTO v_model, v_status FROM ai_models m WHERE m.provider = v_route->>'provider' AND m.provider_model_id = v_route->>'modelId';
    IF v_route_model IS NULL THEN
      -- Empty catalog for this role: the configured model serves, as before T-131.
      INSERT INTO ai_platform_routes (alias, model_id, follows_deployment) VALUES (v_route->>'alias', v_model, true) ON CONFLICT (alias) DO NOTHING;
    ELSIF v_follows AND v_route_model <> v_model AND v_status = 'EVALUATED' THEN
      UPDATE ai_platform_routes SET model_id = v_model, updated_at = now() WHERE alias = v_route->>'alias';
      PERFORM app_ai_system_audit('operator.system.ai_route_switched', v_model);
    ELSIF v_status = 'ADDED' AND app_ai_provider_cleared(v_route->>'provider') THEN
      v_pending := array_append(v_pending, v_model);
    END IF;
  END LOOP;
  RETURN QUERY SELECT m.id, m.provider, m.provider_model_id, m.label FROM ai_models m WHERE m.id = ANY (v_pending) ORDER BY m.label;
END
$$;

-- Claim a configured model's evaluation (no person): one API task at a time, as the console's claim does.
CREATE OR REPLACE FUNCTION app_ai_deployment_evaluating(p_model uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  UPDATE ai_models SET evaluating_since = now(), updated_at = now()
   WHERE id = p_model AND status = 'ADDED' AND app_ai_provider_cleared(provider)
     AND (evaluating_since IS NULL OR evaluating_since < now() - interval '30 minutes');
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM app_ai_system_audit('operator.system.ai_model_evaluation_started', p_model);
  RETURN true;
END
$$;

-- Record a configured model's evaluation. A pass makes it serve and switches it in for the given roles
-- where their platform route still follows the deployment; a fail leaves it not serving. Returns the
-- roles switched.
CREATE OR REPLACE FUNCTION app_ai_deployment_evaluated(p_model uuid, p_passed boolean, p_evaluation jsonb, p_aliases text[]) RETURNS text[]
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE v_switched text[] := ARRAY[]::text[];
BEGIN
  UPDATE ai_models
     SET evaluation = p_evaluation, evaluating_since = NULL, updated_at = now(),
         status = CASE WHEN status = 'RETIRED' THEN status WHEN p_passed THEN 'EVALUATED' ELSE 'ADDED' END
   WHERE id = p_model;
  PERFORM app_ai_system_audit(CASE WHEN p_passed THEN 'operator.system.ai_model_evaluation_passed' ELSE 'operator.system.ai_model_evaluation_failed' END, p_model);
  IF p_passed THEN
    WITH switched AS (
      UPDATE ai_platform_routes SET model_id = p_model, updated_at = now()
       WHERE alias = ANY (coalesce(p_aliases, ARRAY[]::text[])) AND follows_deployment AND model_id <> p_model
      RETURNING alias)
    SELECT coalesce(array_agg(alias), ARRAY[]::text[]) INTO v_switched FROM switched;
    IF cardinality(v_switched) > 0 THEN PERFORM app_ai_system_audit('operator.system.ai_route_switched', p_model); END IF;
  END IF;
  RETURN v_switched;
END
$$;

-- An operator's evaluation: a fail now takes the model out of service (it no longer resolves for any route).
CREATE OR REPLACE FUNCTION app_ops_ai_model_evaluated(p_actor uuid, p_model uuid, p_passed boolean, p_evaluation jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  UPDATE ai_models
     SET evaluation = p_evaluation, evaluating_since = NULL, updated_at = now(),
         status = CASE WHEN status = 'RETIRED' THEN status WHEN p_passed THEN 'EVALUATED' ELSE 'ADDED' END
   WHERE id = p_model;
  PERFORM app_ops_ai_audit(p_actor, CASE WHEN p_passed THEN 'operator.ai_model.evaluation_passed' ELSE 'operator.ai_model.evaluation_failed' END, p_model);
END
$$;

-- An operator's platform route is their choice: a deploy never switches it.
CREATE OR REPLACE FUNCTION app_ops_ai_platform_route_set(p_actor uuid, p_alias text, p_model uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  IF NOT EXISTS (SELECT 1 FROM ai_models m WHERE m.id = p_model AND m.status = 'EVALUATED') THEN RETURN false; END IF;
  INSERT INTO ai_platform_routes (alias, model_id, updated_by, updated_at, follows_deployment) VALUES (p_alias, p_model, p_actor, now(), false)
  ON CONFLICT (alias) DO UPDATE SET model_id = EXCLUDED.model_id, updated_by = EXCLUDED.updated_by, updated_at = now(), follows_deployment = false;
  PERFORM app_ops_ai_audit(p_actor, 'operator.ai_route.set', p_model);
  RETURN true;
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['app_ai_system_audit(text, uuid)', 'app_ai_deployment_sync(jsonb)', 'app_ai_deployment_evaluating(uuid)',
                            'app_ai_deployment_evaluated(uuid, boolean, jsonb, text[])', 'app_ops_ai_model_evaluated(uuid, uuid, boolean, jsonb)',
                            'app_ops_ai_platform_route_set(uuid, text, uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
-- The system audit is internal: only these functions call it.
REVOKE EXECUTE ON FUNCTION app_ai_system_audit(text, uuid) FROM pactlab_app;

COMMIT;
