-- Admin → AI models becomes "models in use" plus "add from Bedrock" (Kumar, 2026-11-21: the catalog table
-- was "junk"). Retire the dead entries left from the evaluation era, so the list holds only real choices:
-- a model that nothing uses (no platform route, no organization route, no allow-list) and that is not
-- serving, failed its last check, or was only adopted from an older deployment. Nothing in use is touched.
-- Data only; re-runnable. Rollback: set status back to 'EVALUATED' / 'ADDED' for the ids audited below.
BEGIN;

ALTER TABLE ai_models NO FORCE ROW LEVEL SECURITY;
UPDATE ai_models m SET status = 'RETIRED', updated_at = now()
 WHERE m.status <> 'RETIRED'
   AND NOT EXISTS (SELECT 1 FROM ai_platform_routes p WHERE p.model_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM organization_ai_routes r WHERE r.model_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM organization_ai_models a WHERE a.model_id = m.id)
   AND (m.status = 'ADDED'
        OR m.evaluation->>'passed' = 'false'
        OR m.evaluation->>'basis' LIKE 'Serving before T-131%');
ALTER TABLE ai_models FORCE ROW LEVEL SECURITY;

COMMIT;
