-- T-072: operator console and bug reports. Expand only.
--
-- Operators (the platform team, not customer org admins) act across
-- organizations only through SECURITY DEFINER functions owned by the no-login
-- role `pactlab_ops`. Every function first checks the caller is an operator
-- (or a privileged non-runtime session, such as the ops CLI run as the schema
-- owner). The runtime role never reads other tenants' tables directly.

ALTER TABLE "users" ADD COLUMN "platform_operator" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pactlab_ops') THEN
    CREATE ROLE pactlab_ops NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
GRANT pactlab_ops TO CURRENT_USER;

-- Per-organization feature flags, changed by operators without a deploy.
CREATE TABLE "organization_flags" (
    "organization_id" UUID NOT NULL,
    "pilot_mode" BOOLEAN NOT NULL DEFAULT false,
    "live_connectors" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_flags_pkey" PRIMARY KEY ("organization_id"),
    CONSTRAINT "organization_flags_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Bug reports: filed by users (with an optional masked screenshot of the app
-- view) or automatically (unhandled errors, server 5xx, exhausted jobs).
-- Deduplicated by fingerprint; context is scrubbed before it is written.
CREATE SEQUENCE "bug_report_number_seq";
CREATE TABLE "bug_reports" (
    "id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID,
    "reporter_user_id" UUID,
    "trigger" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "what_happened" TEXT,
    "expected" TEXT,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "context" JSONB NOT NULL DEFAULT '{}',
    "screenshot" BYTEA,
    "screenshot_type" TEXT,
    "internal_notes" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bug_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bug_reports_trigger_check" CHECK ("trigger" IN ('USER_REPORT', 'FRONTEND_EXCEPTION', 'BACKEND_EXCEPTION', 'JOB_EXHAUSTED')),
    CONSTRAINT "bug_reports_severity_check" CHECK ("severity" IN ('LOW', 'MEDIUM', 'HIGH', 'BLOCKER')),
    CONSTRAINT "bug_reports_status_check" CHECK ("status" IN ('NEW', 'TRIAGED', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX')),
    CONSTRAINT "bug_reports_screenshot_check" CHECK ("screenshot" IS NULL OR (octet_length("screenshot") <= 1500000 AND "screenshot_type" IN ('image/png', 'image/jpeg'))),
    CONSTRAINT "bug_reports_title_check" CHECK (length("title") BETWEEN 3 AND 200),
    CONSTRAINT "bug_reports_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "bug_reports_number_key" ON "bug_reports"("number");
CREATE INDEX "bug_reports_fingerprint_idx" ON "bug_reports"("fingerprint", "status");
CREATE INDEX "bug_reports_reporter_idx" ON "bug_reports"("reporter_user_id", "last_seen_at");

-- Helpers -------------------------------------------------------------------

CREATE FUNCTION app_is_platform_operator(p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT coalesce((SELECT u.platform_operator FROM users u WHERE u.id = p_user), false) $$;

-- The caller must be an operator, or — with no actor — the schema owner's own
-- session (the ops CLI runs as the owner of the tables). The runtime role is
-- neither, so it always needs an operator actor.
CREATE FUNCTION app_ops_require(p_actor uuid) RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF p_actor IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = session_user AND r.rolsuper)
       AND NOT EXISTS (SELECT 1 FROM pg_tables t WHERE t.schemaname = 'public' AND t.tablename = 'organizations' AND t.tableowner = session_user) THEN
      RAISE EXCEPTION 'operator required' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT app_is_platform_operator(p_actor) THEN
    RAISE EXCEPTION 'operator required' USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE FUNCTION app_ops_audit(p_actor uuid, p_org uuid, p_action text, p_target_type text, p_target uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
    VALUES (uuidv7(), p_org, NULL, p_actor, p_action, p_target_type, p_target::text, 'SUCCEEDED')
  $$;

-- Approvals (shared by the console and `pnpm org:*`) -------------------------

CREATE FUNCTION app_ops_pending_organizations(p_actor uuid)
  RETURNS TABLE (slug text, name text, sso_requested boolean, created_at timestamptz, owners text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT o.slug, o.name, o.sso_requested, o.created_at::timestamptz,
           coalesce(string_agg(u.email, ', ' ORDER BY u.email), '')
      FROM organizations o
      LEFT JOIN organization_memberships m ON m.organization_id = o.id AND m.role = 'ORG_OWNER'
      LEFT JOIN users u ON u.id = m.user_id
     WHERE o.status = 'PENDING_APPROVAL'
     GROUP BY o.id ORDER BY o.created_at;
END
$$;

-- Approve (ACTIVE) or reject (SUSPENDED); idempotent; audited. Returns the
-- outcome and the active owners' addresses for the approval email.
CREATE FUNCTION app_ops_decide_organization(p_actor uuid, p_slug text, p_decision text)
  RETURNS TABLE (outcome text, organization_name text, status text, owner_emails text[])
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_org organizations%ROWTYPE;
  v_target organization_status := CASE WHEN p_decision = 'approve' THEN 'ACTIVE'::organization_status ELSE 'SUSPENDED'::organization_status END;
BEGIN
  PERFORM app_ops_require(p_actor);
  IF p_decision NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'bad decision' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_org FROM organizations o WHERE o.slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not-found'::text, NULL::text, NULL::text, ARRAY[]::text[]; RETURN; END IF;
  IF v_org.status = v_target THEN RETURN QUERY SELECT 'unchanged'::text, v_org.name, v_org.status::text, ARRAY[]::text[]; RETURN; END IF;
  UPDATE organizations SET status = v_target, updated_at = now() WHERE id = v_org.id;
  PERFORM app_ops_audit(p_actor, v_org.id, CASE WHEN p_decision = 'approve' THEN 'org.approved' ELSE 'org.rejected' END, 'organization', v_org.id);
  RETURN QUERY
    SELECT 'changed'::text, v_org.name, v_target::text,
           CASE WHEN p_decision = 'approve' THEN coalesce((
             SELECT array_agg(u.email ORDER BY u.email) FROM organization_memberships m JOIN users u ON u.id = m.user_id
              WHERE m.organization_id = v_org.id AND m.role = 'ORG_OWNER' AND m.status = 'ACTIVE' AND u.email IS NOT NULL), ARRAY[]::text[])
           ELSE ARRAY[]::text[] END;
END
$$;

-- Organizations, flags, users, usage (metadata only, never deal content) -----

CREATE FUNCTION app_ops_organizations(p_actor uuid)
  RETURNS TABLE (id uuid, slug text, name text, status text, auth_method text, sso_requested boolean, created_at timestamptz,
                 owners text, members bigint, deals_pre bigint, deals_diligence bigint, deals_post bigint,
                 ai_input_tokens bigint, ai_output_tokens bigint, pilot_mode boolean, live_connectors boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT o.id, o.slug, o.name, o.status::text, o.auth_method::text, o.sso_requested, o.created_at::timestamptz,
           coalesce((SELECT string_agg(u.email, ', ' ORDER BY u.email) FROM organization_memberships m JOIN users u ON u.id = m.user_id
                      WHERE m.organization_id = o.id AND m.role = 'ORG_OWNER'), ''),
           (SELECT count(*) FROM organization_memberships m WHERE m.organization_id = o.id AND m.status = 'ACTIVE'),
           (SELECT count(*) FROM deals d WHERE d.organization_id = o.id AND d.stage = 'SCREENING'),
           (SELECT count(*) FROM deals d WHERE d.organization_id = o.id AND d.stage IN ('DILIGENCE', 'NEGOTIATION', 'SIGNED')),
           (SELECT count(*) FROM deals d WHERE d.organization_id = o.id AND d.stage = 'CLOSED'),
           coalesce((SELECT sum(r.input_tokens) FROM ai_runs r WHERE r.organization_id = o.id), 0)::bigint,
           coalesce((SELECT sum(r.output_tokens) FROM ai_runs r WHERE r.organization_id = o.id), 0)::bigint,
           coalesce(f.pilot_mode, false), coalesce(f.live_connectors, true)
      FROM organizations o LEFT JOIN organization_flags f ON f.organization_id = o.id
     ORDER BY o.created_at;
END
$$;

CREATE FUNCTION app_ops_set_organization_status(p_actor uuid, p_org uuid, p_status text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  IF p_status NOT IN ('ACTIVE', 'SUSPENDED') THEN RAISE EXCEPTION 'bad status' USING ERRCODE = '22023'; END IF;
  UPDATE organizations SET status = p_status::organization_status, updated_at = now() WHERE id = p_org AND status::text <> p_status;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM app_ops_audit(p_actor, p_org, CASE WHEN p_status = 'ACTIVE' THEN 'org.reactivated' ELSE 'org.suspended' END, 'organization', p_org);
  RETURN true;
END
$$;

CREATE FUNCTION app_ops_set_flags(p_actor uuid, p_org uuid, p_pilot_mode boolean, p_live_connectors boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p_org) THEN RAISE EXCEPTION 'no organization' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO organization_flags (organization_id, pilot_mode, live_connectors, updated_by, updated_at)
  VALUES (p_org, p_pilot_mode, p_live_connectors, p_actor, now())
  ON CONFLICT (organization_id) DO UPDATE SET pilot_mode = EXCLUDED.pilot_mode, live_connectors = EXCLUDED.live_connectors, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM app_ops_audit(p_actor, p_org, 'org.flags_changed', 'organization', p_org);
END
$$;

-- The flags of the caller's own organization (any member).
CREATE FUNCTION app_organization_flags(p_org uuid, p_user uuid) RETURNS TABLE (pilot_mode boolean, live_connectors boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT coalesce(f.pilot_mode, false), coalesce(f.live_connectors, true)
      FROM organizations o LEFT JOIN organization_flags f ON f.organization_id = o.id
     WHERE o.id = p_org AND EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = p_org AND m.user_id = p_user AND m.status = 'ACTIVE')
  $$;

CREATE FUNCTION app_ops_users(p_actor uuid, p_org uuid, p_query text)
  RETURNS TABLE (user_id uuid, display_name text, email text, organization_id uuid, organization_name text, role text, status text, platform_operator boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT u.id, u.display_name, u.email, o.id, o.name, m.role::text, m.status::text, u.platform_operator
      FROM organization_memberships m JOIN users u ON u.id = m.user_id JOIN organizations o ON o.id = m.organization_id
     WHERE (p_org IS NULL OR m.organization_id = p_org)
       AND (p_query IS NULL OR u.email ILIKE '%' || p_query || '%' OR u.display_name ILIKE '%' || p_query || '%')
     ORDER BY o.name, u.display_name
     LIMIT 200;
END
$$;

-- Deactivate or reactivate a user's membership of one organization.
CREATE FUNCTION app_ops_set_member_status(p_actor uuid, p_org uuid, p_user uuid, p_status text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  IF p_status NOT IN ('ACTIVE', 'SUSPENDED') THEN RAISE EXCEPTION 'bad status' USING ERRCODE = '22023'; END IF;
  IF p_user = p_actor THEN RAISE EXCEPTION 'operators cannot deactivate themselves' USING ERRCODE = '42501'; END IF;
  UPDATE organization_memberships SET status = p_status::membership_status WHERE organization_id = p_org AND user_id = p_user AND status::text <> p_status;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM app_ops_audit(p_actor, p_org, CASE WHEN p_status = 'ACTIVE' THEN 'member.reactivated' ELSE 'member.deactivated' END, 'user', p_user);
  RETURN true;
END
$$;

CREATE FUNCTION app_ops_connections(p_actor uuid)
  RETURNS TABLE (organization_name text, provider text, display_name text, connection_status text, last_run_status text, last_run_at timestamptz, last_error text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT o.name, c.provider, c.display_name, c.status::text, r.status::text, coalesce(r.completed_at, r.created_at)::timestamptz, r.error_class
      FROM connections c JOIN organizations o ON o.id = c.organization_id
      LEFT JOIN LATERAL (SELECT s.status, s.completed_at, s.created_at, s.error_class FROM sync_runs s WHERE s.connection_id = c.id ORDER BY s.created_at DESC LIMIT 1) r ON true
     ORDER BY o.name, c.provider, c.display_name
     LIMIT 500;
END
$$;

-- Platform-scoped audit events: approvals, flags, suspensions, members, bug triage.
CREATE FUNCTION app_ops_audit_events(p_actor uuid, p_action text, p_since timestamptz, p_limit integer)
  RETURNS TABLE (occurred_at timestamptz, organization_name text, actor_name text, action text, target_type text, target_id text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT e.occurred_at::timestamptz, o.name, u.display_name, e.action, e.target_type, e.target_id
      FROM audit_events e JOIN organizations o ON o.id = e.organization_id LEFT JOIN users u ON u.id = e.actor_user_id
     WHERE e.deal_id IS NULL
       AND (e.action LIKE 'org.%' OR e.action LIKE 'member.%' OR e.action LIKE 'bug.%' OR e.action LIKE 'operator.%')
       AND (p_action IS NULL OR e.action LIKE p_action || '%')
       AND (p_since IS NULL OR e.occurred_at >= p_since)
     ORDER BY e.occurred_at DESC
     LIMIT least(coalesce(p_limit, 200), 500);
END
$$;

-- Bug reports -----------------------------------------------------------------

-- File a bug, or count another occurrence of an open one with the same
-- fingerprint (dedup). The caller scrubs context before calling.
CREATE FUNCTION app_bug_file(
  p_org uuid, p_deal uuid, p_reporter uuid, p_trigger text, p_fingerprint text, p_title text,
  p_what_happened text, p_expected text, p_severity text, p_context jsonb, p_screenshot bytea, p_screenshot_type text
) RETURNS TABLE (id uuid, number integer, deduplicated boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_existing uuid;
  v_number integer;
  v_id uuid := uuidv7();
BEGIN
  IF p_reporter IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = p_org AND m.user_id = p_reporter) THEN
    RAISE EXCEPTION 'reporter is not a member' USING ERRCODE = '42501';
  END IF;
  -- Automatic reports dedup on an open bug; a person's own report is always its own record.
  IF p_trigger <> 'USER_REPORT' THEN
    SELECT b.id, b.number INTO v_existing, v_number FROM bug_reports b
     WHERE b.fingerprint = p_fingerprint AND b.status IN ('NEW', 'TRIAGED', 'IN_PROGRESS')
     ORDER BY b.first_seen_at LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE bug_reports SET occurrences = occurrences + 1, last_seen_at = now(), updated_at = now() WHERE bug_reports.id = v_existing;
      RETURN QUERY SELECT v_existing, v_number, true;
      RETURN;
    END IF;
  END IF;
  v_number := nextval('bug_report_number_seq');
  INSERT INTO bug_reports (id, number, organization_id, deal_id, reporter_user_id, trigger, fingerprint, title, what_happened, expected, severity, context, screenshot, screenshot_type)
  VALUES (v_id, v_number, p_org, p_deal, p_reporter, p_trigger, p_fingerprint, p_title, p_what_happened, p_expected, p_severity, p_context, p_screenshot, p_screenshot_type);
  INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
  VALUES (uuidv7(), p_org, NULL, p_reporter, 'bug.filed', 'bug_report', v_id::text, 'SUCCEEDED');
  RETURN QUERY SELECT v_id, v_number, false;
END
$$;

-- A reporter's own reports (status only), or every report for an operator.
CREATE FUNCTION app_bug_list(p_actor uuid, p_mine boolean)
  RETURNS TABLE (id uuid, number integer, organization_id uuid, organization_name text, deal_id uuid, reporter_user_id uuid, trigger text, title text,
                 severity text, status text, occurrences integer, first_seen_at timestamptz, last_seen_at timestamptz, has_screenshot boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF NOT p_mine THEN PERFORM app_ops_require(p_actor); END IF;
  RETURN QUERY
    SELECT b.id, b.number, b.organization_id, o.name, b.deal_id, b.reporter_user_id, b.trigger, b.title, b.severity, b.status, b.occurrences,
           b.first_seen_at::timestamptz, b.last_seen_at::timestamptz, b.screenshot IS NOT NULL
      FROM bug_reports b JOIN organizations o ON o.id = b.organization_id
     WHERE (NOT p_mine OR b.reporter_user_id = p_actor)
     ORDER BY b.last_seen_at DESC
     LIMIT 500;
END
$$;

-- One report in full (operators), including context, notes and screenshot.
CREATE FUNCTION app_bug_get(p_actor uuid, p_id uuid)
  RETURNS TABLE (id uuid, number integer, organization_id uuid, organization_name text, deal_id uuid, reporter_user_id uuid, trigger text, fingerprint text,
                 title text, what_happened text, expected text, severity text, status text, context jsonb, internal_notes text, occurrences integer,
                 first_seen_at timestamptz, last_seen_at timestamptz, screenshot bytea, screenshot_type text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT b.id, b.number, b.organization_id, o.name, b.deal_id, b.reporter_user_id, b.trigger, b.fingerprint, b.title, b.what_happened, b.expected,
           b.severity, b.status, b.context, b.internal_notes, b.occurrences, b.first_seen_at::timestamptz, b.last_seen_at::timestamptz, b.screenshot, b.screenshot_type
      FROM bug_reports b JOIN organizations o ON o.id = b.organization_id WHERE b.id = p_id;
END
$$;

CREATE FUNCTION app_bug_triage(p_actor uuid, p_id uuid, p_status text, p_severity text, p_notes text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE v_org uuid;
BEGIN
  PERFORM app_ops_require(p_actor);
  UPDATE bug_reports SET status = p_status, severity = p_severity, internal_notes = p_notes, updated_at = now() WHERE bug_reports.id = p_id RETURNING organization_id INTO v_org;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM app_ops_audit(p_actor, v_org, 'bug.triaged', 'bug_report', p_id);
  RETURN true;
END
$$;

-- Privileges: the functions run as `pactlab_ops`, which reads and writes only
-- what they need; the runtime role may only execute them.
ALTER TABLE organization_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_flags FORCE ROW LEVEL SECURITY;
ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bug_reports FORCE ROW LEVEL SECURITY;

GRANT SELECT ON organizations, users, organization_memberships, deals, ai_runs, connections, sync_runs, organization_flags, bug_reports TO pactlab_ops;
GRANT SELECT, INSERT ON audit_events TO pactlab_ops;
GRANT UPDATE (status, updated_at) ON organizations TO pactlab_ops;
GRANT UPDATE (status) ON organization_memberships TO pactlab_ops;
GRANT INSERT, UPDATE ON organization_flags TO pactlab_ops;
GRANT INSERT, UPDATE (occurrences, last_seen_at, updated_at, status, severity, internal_notes) ON bug_reports TO pactlab_ops;
GRANT USAGE ON SEQUENCE bug_report_number_seq TO pactlab_ops;

CREATE POLICY organizations_ops ON organizations FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);
CREATE POLICY users_ops ON users FOR SELECT TO pactlab_ops USING (true);
CREATE POLICY organization_memberships_ops ON organization_memberships FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);
CREATE POLICY deals_ops ON deals FOR SELECT TO pactlab_ops USING (true);
CREATE POLICY ai_runs_ops ON ai_runs FOR SELECT TO pactlab_ops USING (true);
CREATE POLICY connections_ops ON connections FOR SELECT TO pactlab_ops USING (true);
CREATE POLICY sync_runs_ops ON sync_runs FOR SELECT TO pactlab_ops USING (true);
CREATE POLICY audit_events_ops ON audit_events FOR ALL TO pactlab_ops USING (true) WITH CHECK (actor_user_id IS NULL OR action LIKE 'org.%' OR action LIKE 'member.%' OR action LIKE 'bug.%' OR action LIKE 'operator.%');
CREATE POLICY organization_flags_ops ON organization_flags FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);
CREATE POLICY bug_reports_ops ON bug_reports FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_is_platform_operator(uuid)', 'app_ops_require(uuid)', 'app_ops_audit(uuid, uuid, text, text, uuid)',
    'app_ops_pending_organizations(uuid)', 'app_ops_decide_organization(uuid, text, text)', 'app_ops_organizations(uuid)',
    'app_ops_set_organization_status(uuid, uuid, text)', 'app_ops_set_flags(uuid, uuid, boolean, boolean)', 'app_organization_flags(uuid, uuid)',
    'app_ops_users(uuid, uuid, text)', 'app_ops_set_member_status(uuid, uuid, uuid, text)', 'app_ops_connections(uuid)',
    'app_ops_audit_events(uuid, text, timestamptz, integer)',
    'app_bug_file(uuid, uuid, uuid, text, text, text, text, text, text, jsonb, bytea, text)', 'app_bug_list(uuid, boolean)',
    'app_bug_get(uuid, uuid)', 'app_bug_triage(uuid, uuid, text, text, text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
