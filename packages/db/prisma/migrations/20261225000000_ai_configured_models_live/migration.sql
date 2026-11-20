-- Configured models go live on deploy (Kumar, 2026-11-20: "Do we even need all this evaluation steps?").
-- The evaluation gate is replaced by a health check in the console; a deployment's configured frontier
-- models are trusted. At boot each configured model serves at once, and becomes the platform default for
-- its role unless an operator chose that role (follows_deployment = false). A model a health check failed
-- is made serving again when the deployment configures it (the deploy is the decision).
-- Expand-only; re-runnable. Rollback: restore app_ai_deployment_sync from 20261224000000.
BEGIN;

CREATE OR REPLACE FUNCTION app_ai_deployment_sync(p_routes jsonb) RETURNS TABLE (model_id uuid, provider text, provider_model_id text, label text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_route jsonb;
  v_model uuid;
  v_route_model uuid;
  v_follows boolean;
BEGIN
  FOR v_route IN SELECT * FROM jsonb_array_elements(p_routes) LOOP
    IF v_route->>'alias' NOT IN ('fast', 'balanced', 'deep_review') THEN CONTINUE; END IF;
    INSERT INTO ai_models (id, provider, provider_model_id, label, status, evaluation)
    VALUES (uuidv7(), v_route->>'provider', v_route->>'modelId', v_route->>'label', 'EVALUATED',
            jsonb_build_object('basis', 'Configured for this deployment', 'configuredAt', now()))
    ON CONFLICT (provider, provider_model_id) DO NOTHING;
    -- Already in the catalog but not serving (an earlier gate failed it): the deployment configures it, so it serves.
    UPDATE ai_models SET status = 'EVALUATED', evaluating_since = NULL, updated_at = now()
     WHERE provider = v_route->>'provider' AND provider_model_id = v_route->>'modelId' AND status = 'ADDED';
    SELECT m.id INTO v_model FROM ai_models m WHERE m.provider = v_route->>'provider' AND m.provider_model_id = v_route->>'modelId';
    SELECT p.model_id, p.follows_deployment INTO v_route_model, v_follows FROM ai_platform_routes p WHERE p.alias = v_route->>'alias';
    IF v_route_model IS NULL THEN
      INSERT INTO ai_platform_routes (alias, model_id, follows_deployment) VALUES (v_route->>'alias', v_model, true) ON CONFLICT (alias) DO NOTHING;
    ELSIF v_follows AND v_route_model <> v_model THEN
      UPDATE ai_platform_routes SET model_id = v_model, updated_at = now() WHERE alias = v_route->>'alias';
      PERFORM app_ai_system_audit('operator.system.ai_route_switched', v_model);
    END IF;
  END LOOP;
  -- Nothing waits for an evaluation any more.
  RETURN;
END
$$;

COMMIT;
