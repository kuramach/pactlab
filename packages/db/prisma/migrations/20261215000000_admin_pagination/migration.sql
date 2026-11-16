-- Admin console pagination (T-126): every console list pages by keyset (sort key, id) and reports
-- its total, replacing silent caps (users 200, audit 500, bugs 500, connections 500) and the
-- per-row scans of the organizations list. New *_page functions; the old ones stay for the
-- release that is still running (expand); a later release drops them (contract). Callers ask for one
-- row more than a page (at most 101) to know whether another page follows.
-- Rollback: drop the *_page functions. Re-runnable.
BEGIN;

-- Users: by organization name, then name; searchable by email or name; one row per membership.
CREATE OR REPLACE FUNCTION app_ops_users_page(p_actor uuid, p_org uuid, p_query text, p_after_key text, p_after_id uuid, p_limit integer)
  RETURNS TABLE (membership_id uuid, sort_key text, user_id uuid, display_name text, email text, organization_id uuid, organization_name text,
                 role text, status text, platform_operator boolean, total bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    WITH matching AS (
      SELECT m.id AS membership_id, lower(o.name) || chr(1) || lower(u.display_name) AS sort_key, u.id AS user_id, u.display_name, u.email,
             o.id AS organization_id, o.name AS organization_name, m.role::text AS role, m.status::text AS status, u.platform_operator
        FROM organization_memberships m JOIN users u ON u.id = m.user_id JOIN organizations o ON o.id = m.organization_id
       WHERE (p_org IS NULL OR m.organization_id = p_org)
         AND (p_query IS NULL OR u.email ILIKE '%' || p_query || '%' OR u.display_name ILIKE '%' || p_query || '%')
    )
    SELECT x.*, (SELECT count(*) FROM matching) FROM matching x
     WHERE p_after_key IS NULL OR (x.sort_key, x.membership_id) > (p_after_key, p_after_id)
     ORDER BY x.sort_key, x.membership_id
     LIMIT least(greatest(coalesce(p_limit, 51), 1), 101);
END
$$;

-- Organizations: newest first, searchable by name or slug. Counts are computed for the page only.
CREATE OR REPLACE FUNCTION app_ops_organizations_page(p_actor uuid, p_query text, p_after_at timestamptz, p_after_id uuid, p_limit integer)
  RETURNS TABLE (id uuid, slug text, name text, status text, auth_method text, sso_requested boolean, created_at timestamptz,
                 owners text, members bigint, deals_pre bigint, deals_diligence bigint, deals_post bigint,
                 ai_input_tokens bigint, ai_output_tokens bigint, pilot_mode boolean, live_connectors boolean, mcp_enabled boolean, total bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    WITH matching AS (
      SELECT o.* FROM organizations o
       WHERE p_query IS NULL OR o.name ILIKE '%' || p_query || '%' OR o.slug ILIKE '%' || p_query || '%'
    ), page AS (
      SELECT x.* FROM matching x
       WHERE p_after_at IS NULL OR (x.created_at, x.id) < (p_after_at, p_after_id)
       ORDER BY x.created_at DESC, x.id DESC
       LIMIT least(greatest(coalesce(p_limit, 51), 1), 101)
    )
    SELECT p.id, p.slug, p.name, p.status::text, p.auth_method::text, p.sso_requested, p.created_at::timestamptz,
           coalesce(own.emails, ''), coalesce(mem.n, 0), coalesce(dl.pre, 0), coalesce(dl.diligence, 0), coalesce(dl.post, 0),
           coalesce(ai.input_tokens, 0), coalesce(ai.output_tokens, 0),
           coalesce(f.pilot_mode, false), coalesce(f.live_connectors, true), coalesce(f.mcp_enabled, false),
           (SELECT count(*) FROM matching)
      FROM page p
      LEFT JOIN organization_flags f ON f.organization_id = p.id
      LEFT JOIN LATERAL (SELECT string_agg(u.email, ', ' ORDER BY u.email) AS emails FROM organization_memberships m JOIN users u ON u.id = m.user_id
                          WHERE m.organization_id = p.id AND m.role = 'ORG_OWNER') own ON true
      LEFT JOIN LATERAL (SELECT count(*) AS n FROM organization_memberships m WHERE m.organization_id = p.id AND m.status = 'ACTIVE') mem ON true
      LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE d.stage = 'SCREENING') AS pre,
                                count(*) FILTER (WHERE d.stage IN ('DILIGENCE', 'NEGOTIATION', 'SIGNED')) AS diligence,
                                count(*) FILTER (WHERE d.stage = 'CLOSED') AS post
                           FROM deals d WHERE d.organization_id = p.id) dl ON true
      LEFT JOIN LATERAL (SELECT sum(r.input_tokens)::bigint AS input_tokens, sum(r.output_tokens)::bigint AS output_tokens FROM ai_runs r WHERE r.organization_id = p.id) ai ON true
     ORDER BY p.created_at DESC, p.id DESC;
END
$$;

-- Connections: by organization, provider and name, each with its last sync run.
CREATE OR REPLACE FUNCTION app_ops_connections_page(p_actor uuid, p_after_key text, p_after_id uuid, p_limit integer)
  RETURNS TABLE (id uuid, sort_key text, organization_name text, provider text, display_name text, connection_status text,
                 last_run_status text, last_run_at timestamptz, last_error text, total bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    WITH matching AS (
      SELECT c.id, lower(o.name) || chr(1) || c.provider || chr(1) || lower(c.display_name) AS sort_key, o.name AS organization_name, c.provider, c.display_name, c.status::text AS connection_status
        FROM connections c JOIN organizations o ON o.id = c.organization_id
    ), page AS (
      SELECT x.* FROM matching x
       WHERE p_after_key IS NULL OR (x.sort_key, x.id) > (p_after_key, p_after_id)
       ORDER BY x.sort_key, x.id
       LIMIT least(greatest(coalesce(p_limit, 51), 1), 101)
    )
    SELECT p.id, p.sort_key, p.organization_name, p.provider, p.display_name, p.connection_status,
           r.status::text, coalesce(r.completed_at, r.created_at)::timestamptz, r.error_class, (SELECT count(*) FROM matching)
      FROM page p
      LEFT JOIN LATERAL (SELECT s.status, s.completed_at, s.created_at, s.error_class FROM sync_runs s WHERE s.connection_id = p.id ORDER BY s.created_at DESC LIMIT 1) r ON true
     ORDER BY p.sort_key, p.id;
END
$$;

-- Platform audit events: newest first, filtered by action prefix.
CREATE OR REPLACE FUNCTION app_ops_audit_events_page(p_actor uuid, p_action text, p_after_at timestamptz, p_after_id uuid, p_limit integer)
  RETURNS TABLE (id uuid, occurred_at timestamptz, organization_name text, actor_name text, action text, target_type text, target_id text, total bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    WITH matching AS (
      SELECT e.id, e.occurred_at::timestamptz AS occurred_at, e.organization_id, e.actor_user_id, e.action, e.target_type, e.target_id
        FROM audit_events e
       WHERE e.deal_id IS NULL
         AND (e.action LIKE 'org.%' OR e.action LIKE 'member.%' OR e.action LIKE 'bug.%' OR e.action LIKE 'operator.%' OR e.action LIKE 'demo.%')
         AND (p_action IS NULL OR e.action LIKE p_action || '%')
    )
    SELECT x.id, x.occurred_at, o.name, u.display_name, x.action, x.target_type, x.target_id, (SELECT count(*) FROM matching)
      FROM matching x JOIN organizations o ON o.id = x.organization_id LEFT JOIN users u ON u.id = x.actor_user_id
     WHERE p_after_at IS NULL OR (x.occurred_at, x.id) < (p_after_at, p_after_id)
     ORDER BY x.occurred_at DESC, x.id DESC
     LIMIT least(greatest(coalesce(p_limit, 51), 1), 101);
END
$$;

-- Bug reports: most recently seen first, filtered by status and severity in the database.
CREATE OR REPLACE FUNCTION app_bug_list_page(p_actor uuid, p_mine boolean, p_status text, p_severity text, p_after_at timestamptz, p_after_id uuid, p_limit integer)
  RETURNS TABLE (id uuid, number integer, organization_id uuid, organization_name text, deal_id uuid, reporter_user_id uuid, trigger text, title text,
                 severity text, status text, occurrences integer, first_seen_at timestamptz, last_seen_at timestamptz, has_screenshot boolean, total bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF NOT p_mine THEN PERFORM app_ops_require(p_actor); END IF;
  RETURN QUERY
    WITH matching AS (
      SELECT b.* FROM bug_reports b
       WHERE (NOT p_mine OR b.reporter_user_id = p_actor)
         AND (p_status IS NULL OR b.status = p_status)
         AND (p_severity IS NULL OR b.severity = p_severity)
    )
    SELECT b.id, b.number, b.organization_id, o.name, b.deal_id, b.reporter_user_id, b.trigger, b.title, b.severity, b.status, b.occurrences,
           b.first_seen_at::timestamptz, b.last_seen_at::timestamptz, b.screenshot IS NOT NULL, (SELECT count(*) FROM matching)
      FROM matching b JOIN organizations o ON o.id = b.organization_id
     WHERE p_after_at IS NULL OR (b.last_seen_at, b.id) < (p_after_at, p_after_id)
     ORDER BY b.last_seen_at DESC, b.id DESC
     LIMIT least(greatest(coalesce(p_limit, 51), 1), 101);
END
$$;

-- Promo codes: newest first.
CREATE OR REPLACE FUNCTION app_promo_list_page(p_actor uuid, p_after_at timestamptz, p_after_id uuid, p_limit integer)
  RETURNS TABLE (id uuid, code text, description text, kind text, percent_off numeric, amount_off numeric, currency text, duration text, duration_months integer,
                 plan_keys text[], free_pacts integer, packs text[], valid_from timestamptz, valid_until timestamptz, max_redemptions integer,
                 skips_approval boolean, active boolean, redemptions integer, stripe_promotion_code_id text, created_at timestamptz, total bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT c.id, c.code, c.description, c.kind, c.percent_off, c.amount_off, c.currency::text, c.duration, c.duration_months, c.plan_keys, c.free_pacts, c.packs,
           c.valid_from, c.valid_until, c.max_redemptions, c.skips_approval, c.active,
           (SELECT count(*)::int FROM promo_redemptions r WHERE r.promo_id = c.id), c.stripe_promotion_code_id, c.created_at,
           (SELECT count(*) FROM promo_codes)
      FROM promo_codes c
     WHERE p_after_at IS NULL OR (c.created_at, c.id) < (p_after_at, p_after_id)
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT least(greatest(coalesce(p_limit, 51), 1), 101);
END
$$;

-- Platform usage totals for Usage & health: one aggregate, not a sum over a page of organizations.
CREATE OR REPLACE FUNCTION app_ops_usage_totals(p_actor uuid)
  RETURNS TABLE (organizations bigint, ai_input_tokens bigint, ai_output_tokens bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT (SELECT count(*) FROM organizations), coalesce(sum(r.input_tokens), 0)::bigint, coalesce(sum(r.output_tokens), 0)::bigint FROM ai_runs r;
END
$$;

-- Billing for the organizations on one page of the console (at most 100).
CREATE OR REPLACE FUNCTION app_billing_admin_accounts_for(p_actor uuid, p_orgs uuid[])
  RETURNS TABLE (organization_id uuid, plan_key text, status text, period_end timestamptz, pacts_used integer, open_credits integer, stripe_customer_id text, subscription_id text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  IF cardinality(p_orgs) > 100 THEN RAISE EXCEPTION 'at most 100 organizations' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
    SELECT o.id, a.plan_key, coalesce(a.status, 'NONE'), a.period_end, coalesce(a.pacts_used, 0),
           (SELECT count(*)::int FROM pact_credits c WHERE c.organization_id = o.id AND c.consumed_at IS NULL),
           a.stripe_customer_id, a.subscription_id
      FROM organizations o LEFT JOIN billing_accounts a ON a.organization_id = o.id
     WHERE o.id = ANY (p_orgs);
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_ops_users_page(uuid, uuid, text, text, uuid, integer)', 'app_ops_organizations_page(uuid, text, timestamptz, uuid, integer)',
    'app_ops_connections_page(uuid, text, uuid, integer)', 'app_ops_audit_events_page(uuid, text, timestamptz, uuid, integer)',
    'app_bug_list_page(uuid, boolean, text, text, timestamptz, uuid, integer)', 'app_ops_usage_totals(uuid)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['app_promo_list_page(uuid, timestamptz, uuid, integer)', 'app_billing_admin_accounts_for(uuid, uuid[])'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_billing', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;

COMMIT;
