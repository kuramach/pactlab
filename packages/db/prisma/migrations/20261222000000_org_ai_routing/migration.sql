-- The routing diagram (Kumar, 2026-11-19): an organization's own owner or admin chooses its AI models
-- per job, from the models Pactlab has approved for it (EVALUATED, terms recorded, and on the
-- organization's allow-list when an operator set one). Expand-only; re-runnable.
-- Rollback: drop the four functions.
BEGIN;

-- Which route keys the platform has set (the diagram marks them "platform default").
CREATE OR REPLACE FUNCTION app_ai_platform_route_keys() RETURNS TABLE (alias text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT p.alias FROM ai_platform_routes p ORDER BY p.alias $$;

-- Which route keys an organization has set itself (the diagram marks them "this organization").
CREATE OR REPLACE FUNCTION app_ai_org_route_keys(p_org uuid) RETURNS TABLE (alias text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT r.alias FROM organization_ai_routes r WHERE r.organization_id = p_org ORDER BY r.alias $$;

-- The models an organization may choose: EVALUATED, terms recorded, on its allow-list when it has one.
CREATE OR REPLACE FUNCTION app_ai_org_choices(p_org uuid) RETURNS TABLE (id uuid, provider text, provider_model_id text, label text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT m.id, m.provider, m.provider_model_id, m.label FROM ai_models m
     WHERE m.status = 'EVALUATED' AND app_ai_provider_cleared(m.provider)
       AND (NOT EXISTS (SELECT 1 FROM organization_ai_models a WHERE a.organization_id = p_org)
            OR EXISTS (SELECT 1 FROM organization_ai_models a WHERE a.organization_id = p_org AND a.model_id = m.id))
     ORDER BY m.label
  $$;

-- An organization's owner or admin sets (p_model) or clears (NULL) one of its routes. Re-checked here,
-- whatever the API decided: the actor's active membership and role, the key, and the model's approval.
-- Never touches the allow-list (operators' alone). Audited under the organization.
CREATE OR REPLACE FUNCTION app_ai_org_route_set(p_actor uuid, p_org uuid, p_key text, p_model uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = p_org AND m.user_id = p_actor AND m.status = 'ACTIVE' AND m.role IN ('ORG_OWNER', 'ORG_ADMIN')) THEN
    RETURN 'NOT_ADMIN';
  END IF;
  IF p_key NOT IN ('fast', 'balanced', 'deep_review', 'contract_scrub', 'extraction', 'classification', 'document_qa', 'vision') THEN RETURN 'BAD_KEY'; END IF;
  IF p_model IS NULL THEN
    DELETE FROM organization_ai_routes WHERE organization_id = p_org AND alias = p_key;
    PERFORM app_ops_audit(p_actor, p_org, 'org.ai_route_cleared', 'organization', p_org);
    RETURN 'CLEARED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_ai_org_choices(p_org) c WHERE c.id = p_model) THEN RETURN 'NOT_ALLOWED'; END IF;
  INSERT INTO organization_ai_routes (organization_id, alias, model_id, updated_by) VALUES (p_org, p_key, p_model, p_actor)
  ON CONFLICT (organization_id, alias) DO UPDATE SET model_id = EXCLUDED.model_id, updated_by = EXCLUDED.updated_by;
  PERFORM app_ops_audit(p_actor, p_org, 'org.ai_route_set', 'organization', p_org);
  RETURN 'SAVED';
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['app_ai_platform_route_keys()', 'app_ai_org_route_keys(uuid)', 'app_ai_org_choices(uuid)', 'app_ai_org_route_set(uuid, uuid, text, uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;

COMMIT;
