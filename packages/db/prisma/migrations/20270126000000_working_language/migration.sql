-- T-174b (ADR 0067 addendum): the languages a pact and an AI run are in.
--
-- deals.working_language: the language the pact's emails and generated documents are written in when the reader has
-- chosen none (`en | de | fr | ja`). Null follows the organization's default, and English until one is stored (T-172b).
-- Set by the deal lead or an analyst (PATCH /v1/deals/:id); every change is audited (`deal.working_language_set`). RLS on deals as before.
--
-- ai_runs.output_language / output_language_written / output_language_fallback: the language a job asked for, the
-- language it wrote in, and whether it fell back because the model is not evaluated in the asked language (ADR 0034).
-- Null when the job named no language. Never content.
--
-- Expand-only: nullable columns, their checks and one new function; old code ignores them. Rollback: drop
-- app_notification_deal_languages(uuid[]), then the four columns (and checks).

ALTER TABLE deals ADD COLUMN working_language text;
ALTER TABLE deals ADD CONSTRAINT deals_working_language_check CHECK (working_language IS NULL OR working_language IN ('en', 'de', 'fr', 'ja'));

ALTER TABLE ai_runs ADD COLUMN output_language text;
ALTER TABLE ai_runs ADD COLUMN output_language_written text;
ALTER TABLE ai_runs ADD COLUMN output_language_fallback boolean;
ALTER TABLE ai_runs ADD CONSTRAINT ai_runs_output_language_check CHECK (
  (output_language IS NULL AND output_language_written IS NULL AND output_language_fallback IS NULL)
  OR (output_language IN ('en', 'de', 'fr', 'ja') AND output_language_written IN ('en', 'de', 'fr', 'ja') AND output_language_fallback IS NOT NULL)
);

-- The notification dispatcher works across organizations, so it reads the pacts' working languages through a
-- SECURITY DEFINER function, as it reads pending items: the language only, never the pact.
GRANT SELECT (working_language) ON deals TO pactlab_auth;

CREATE FUNCTION app_notification_deal_languages(p_deal_ids uuid[])
  RETURNS TABLE (deal_id uuid, working_language text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  SELECT d.id, d.working_language
    FROM deals d
   WHERE d.id = ANY (p_deal_ids[1:500]) AND d.working_language IS NOT NULL
$$;
ALTER FUNCTION app_notification_deal_languages(uuid[]) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_notification_deal_languages(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_notification_deal_languages(uuid[]) TO pactlab_app;
