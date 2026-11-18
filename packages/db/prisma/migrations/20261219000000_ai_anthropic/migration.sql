-- Claude through the direct Anthropic API (T-132 PR 1): the interim Claude lane while Bedrock is blocked
-- org-wide, and a lane of its own afterwards. A provider outside AWS, so its models serve only with its
-- data terms recorded (app_ai_provider_cleared already requires them for any provider but bedrock and
-- the fixture). Expand-only; re-runnable. Rollback: restore the two check constraints without 'anthropic'.
BEGIN;
ALTER TABLE ai_models DROP CONSTRAINT IF EXISTS ai_models_provider;
ALTER TABLE ai_models ADD CONSTRAINT ai_models_provider CHECK ("provider" IN ('bedrock', 'anthropic', 'openai', 'google', 'fixture'));
ALTER TABLE ai_provider_terms DROP CONSTRAINT IF EXISTS ai_provider_terms_provider;
ALTER TABLE ai_provider_terms ADD CONSTRAINT ai_provider_terms_provider CHECK ("provider" IN ('anthropic', 'openai', 'google'));
COMMIT;
