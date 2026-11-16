-- Hosting cost, faster and paged (T-126): metered estimates are priced and summed in the database
-- per breakdown (organization, pact, person, sign-in method, model), ordered by cost and paged by
-- keyset (total, key), so the API returns finished rows a page at a time instead of every
-- day x model x organization x pact x person row. Indexes serve the period scans.
-- Expand-only; rollback: drop the two functions and the two indexes. Re-runnable.
BEGIN;

CREATE INDEX IF NOT EXISTS "ai_runs_created_idx" ON "ai_runs"("created_at");
CREATE INDEX IF NOT EXISTS "documents_created_idx" ON "documents"("created_at");

-- One breakdown of the metered estimate for [p_from, p_to), most expensive first, a page at a time.
-- p_dimension: organization | pact | person | auth | model. Ask for one row more than a page (at most 101).
CREATE OR REPLACE FUNCTION app_ops_cost_metered_page(p_actor uuid, p_from date, p_to date, p_dimension text, p_after_total numeric, p_after_key text, p_limit integer)
  RETURNS TABLE (key text, label text, detail text, runs bigint, input_tokens bigint, output_tokens bigint, gb_months numeric, ai numeric, storage numeric, total numeric, total_rows bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  IF p_dimension NOT IN ('organization', 'pact', 'person', 'auth', 'model') THEN RAISE EXCEPTION 'bad dimension' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
    WITH ai AS (
      SELECT (r.created_at AT TIME ZONE 'UTC')::date AS day, r.resolved_model_id AS model, r.organization_id, r.deal_id, r.requested_by,
             count(*) AS n, sum(r.input_tokens)::bigint AS it, sum(r.output_tokens)::bigint AS ot
        FROM ai_runs r
       WHERE r.created_at >= p_from AND r.created_at < p_to
       GROUP BY 1, 2, 3, 4, 5
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
                              WHEN 'auth' THEN (SELECT o.auth_method::text FROM organizations o WHERE o.id = a.organization_id) ELSE a.model END AS k,
             a.n AS n, a.it AS it, a.ot AS ot, 0::numeric AS gbm, a.cost AS ai_cost, 0::numeric AS storage_cost
        FROM ai_priced a
      UNION ALL
      SELECT CASE p_dimension WHEN 'organization' THEN h.organization_id::text WHEN 'pact' THEN h.deal_id::text WHEN 'person' THEN coalesce(h.requested_by::text, 'unknown')
                              ELSE (SELECT o.auth_method::text FROM organizations o WHERE o.id = h.organization_id) END,
             0, 0, 0, h.gbm, 0, h.cost
        FROM held_priced h
       WHERE p_dimension <> 'model'
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

-- The metered totals for [p_from, p_to), and the rates that are missing (counted, never guessed).
CREATE OR REPLACE FUNCTION app_ops_cost_metered_totals(p_actor uuid, p_from date, p_to date)
  RETURNS TABLE (ai numeric, storage numeric, missing_rates text[])
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    WITH ai AS (
      SELECT (r.created_at AT TIME ZONE 'UTC')::date AS day, r.resolved_model_id AS model, sum(r.input_tokens)::bigint AS it, sum(r.output_tokens)::bigint AS ot
        FROM ai_runs r WHERE r.created_at >= p_from AND r.created_at < p_to GROUP BY 1, 2
    ), priced AS (
      SELECT a.model, ri.unit_price AS rin, ro.unit_price AS rout,
             coalesce(a.it::numeric / 1000000 * ri.unit_price, 0) + coalesce(a.ot::numeric / 1000000 * ro.unit_price, 0) AS cost
        FROM ai a
        LEFT JOIN LATERAL (SELECT c.unit_price FROM cost_rates c WHERE c.kind = 'BEDROCK_INPUT_PER_MTOK' AND c.key = a.model AND c.effective_from <= a.day ORDER BY c.effective_from DESC LIMIT 1) ri ON true
        LEFT JOIN LATERAL (SELECT c.unit_price FROM cost_rates c WHERE c.kind = 'BEDROCK_OUTPUT_PER_MTOK' AND c.key = a.model AND c.effective_from <= a.day ORDER BY c.effective_from DESC LIMIT 1) ro ON true
    ), held AS (
      SELECT coalesce(sum(doc.size_bytes::numeric * greatest(extract(epoch FROM (least(coalesce(doc.purged_at, now()), p_to::timestamptz, now()) - greatest(doc.created_at, p_from::timestamptz))), 0) / 86400), 0) AS byte_days,
             count(*) AS n
        FROM documents doc WHERE doc.created_at < p_to AND (doc.purged_at IS NULL OR doc.purged_at >= p_from)
    ), storage_rate AS (
      SELECT c.unit_price FROM cost_rates c WHERE c.kind = 'S3_STORAGE_GB_MONTH' AND c.key = 'standard' AND c.effective_from <= (p_to - 1) ORDER BY c.effective_from DESC LIMIT 1
    )
    SELECT coalesce((SELECT sum(p.cost) FROM priced p), 0),
           coalesce((SELECT h.byte_days / 1073741824 / 30 * (SELECT s.unit_price FROM storage_rate s) FROM held h), 0),
           array(
             SELECT DISTINCT m FROM (
               SELECT 'BEDROCK_INPUT_PER_MTOK ' || p.model AS m FROM priced p WHERE p.rin IS NULL
               UNION SELECT 'BEDROCK_OUTPUT_PER_MTOK ' || p.model FROM priced p WHERE p.rout IS NULL
               UNION SELECT 'S3_STORAGE_GB_MONTH standard' WHERE (SELECT h.n FROM held h) > 0 AND NOT EXISTS (SELECT 1 FROM storage_rate)
             ) missing ORDER BY m
           );
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['app_ops_cost_metered_page(uuid, date, date, text, numeric, text, integer)', 'app_ops_cost_metered_totals(uuid, date, date)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;

COMMIT;
