-- A job type of its own for reading spreadsheets for import (Kumar, 2026-11-25: "use the best model inside Bedrock for
-- most optimal import outcome"): `import_mapping`, routed to Opus 5.5 then Sonnet 5.5 (packages/ai/src/jobs.ts), shown
-- and overridable apart from contract extraction. Widens the route-key lists only; the functions are otherwise unchanged
-- (CREATE OR REPLACE keeps their owners and grants). Rollback: restore the constraints and the three functions from
-- 20261219000100_ai_job_routing and 20261222000000_org_ai_routing (after removing any 'import_mapping' routes).
BEGIN;

ALTER TABLE ai_platform_routes DROP CONSTRAINT IF EXISTS ai_platform_routes_alias;
ALTER TABLE ai_platform_routes ADD CONSTRAINT ai_platform_routes_alias CHECK ("alias" IN ('fast', 'balanced', 'deep_review', 'contract_scrub', 'extraction', 'classification', 'document_qa', 'vision', 'import_mapping'));
ALTER TABLE organization_ai_routes DROP CONSTRAINT IF EXISTS organization_ai_routes_alias;
ALTER TABLE organization_ai_routes ADD CONSTRAINT organization_ai_routes_alias CHECK ("alias" IN ('fast', 'balanced', 'deep_review', 'contract_scrub', 'extraction', 'classification', 'document_qa', 'vision', 'import_mapping'));

CREATE OR REPLACE FUNCTION app_ai_routes_for(p_org uuid)
  RETURNS TABLE (alias text, provider text, provider_model_id text, label text, blocked boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    WITH aliases(alias) AS (VALUES ('fast'), ('balanced'), ('deep_review'), ('contract_scrub'), ('extraction'), ('classification'), ('document_qa'), ('vision'), ('import_mapping')),
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
    IF v_alias NOT IN ('fast', 'balanced', 'deep_review', 'contract_scrub', 'extraction', 'classification', 'document_qa', 'vision', 'import_mapping') THEN RETURN 'BAD_ALIAS'; END IF;
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

CREATE OR REPLACE FUNCTION app_ai_org_route_set(p_actor uuid, p_org uuid, p_key text, p_model uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = p_org AND m.user_id = p_actor AND m.status = 'ACTIVE' AND m.role IN ('ORG_OWNER', 'ORG_ADMIN')) THEN
    RETURN 'NOT_ADMIN';
  END IF;
  IF p_key NOT IN ('fast', 'balanced', 'deep_review', 'contract_scrub', 'extraction', 'classification', 'document_qa', 'vision', 'import_mapping') THEN RETURN 'BAD_KEY'; END IF;
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

COMMIT;
