-- Tenant isolation, append-only audit chain and object-key guard.
--
-- Runtime model: application login roles are granted membership in
-- `pactlab_app` and every transaction runs `SET LOCAL ROLE pactlab_app` plus
-- the `app.*` settings below, derived from a verified server-side identity.
-- `pactlab_app` cannot bypass RLS, owns nothing and has no DELETE rights.
-- Policies deny by default: a missing setting resolves to NULL / empty set.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pactlab_app') THEN
    CREATE ROLE pactlab_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Tenant context accessors
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_current_organization_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.organization_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app_current_auth_subject() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.auth_subject', true), '') $$;

-- Permitted deal IDs as a Postgres array literal, e.g. '{uuid,uuid}'.
CREATE FUNCTION app_current_deal_ids() RETURNS uuid[]
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(nullif(current_setting('app.deal_ids', true), '')::uuid[], '{}'::uuid[]) $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO pactlab_app;
GRANT EXECUTE ON FUNCTION
  app_current_organization_id(),
  app_current_user_id(),
  app_current_auth_subject(),
  app_current_deal_ids()
TO pactlab_app;

GRANT SELECT ON organizations, users TO pactlab_app;
GRANT SELECT, INSERT, UPDATE ON organization_memberships, deals, deal_memberships, job_runs, stored_files
  TO pactlab_app;
GRANT SELECT, INSERT ON audit_events, outbox_events TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Row-level security (FORCE so the table owner is also subject to policies)
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals FORCE ROW LEVEL SECURITY;
ALTER TABLE deal_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE stored_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE stored_files FORCE ROW LEVEL SECURITY;

-- Identity tables. Principal resolution reads the caller's own user row by
-- verified subject, then their memberships, then the matching organization.
-- Policies reference only "lower" tables to avoid policy recursion:
-- organizations -> organization_memberships; users -> organization_memberships.
CREATE POLICY organization_memberships_select ON organization_memberships FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() OR user_id = app_current_user_id());
CREATE POLICY organization_memberships_insert ON organization_memberships FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id());
CREATE POLICY organization_memberships_update ON organization_memberships FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

CREATE POLICY organizations_select ON organizations FOR SELECT TO pactlab_app
  USING (
    id = app_current_organization_id()
    OR id IN (SELECT m.organization_id FROM organization_memberships m WHERE m.user_id = app_current_user_id())
  );

CREATE POLICY users_select ON users FOR SELECT TO pactlab_app
  USING (
    auth0_subject = app_current_auth_subject()
    OR id = app_current_user_id()
    OR id IN (SELECT m.user_id FROM organization_memberships m WHERE m.organization_id = app_current_organization_id())
  );

-- Deals: visible only inside the current organization AND the permitted deal set.
CREATE POLICY deals_select ON deals FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND id = ANY (app_current_deal_ids()));
CREATE POLICY deals_insert ON deals FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND created_by = app_current_user_id());
CREATE POLICY deals_update ON deals FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND id = ANY (app_current_deal_ids()))
  WITH CHECK (organization_id = app_current_organization_id() AND id = ANY (app_current_deal_ids()));

-- Deal memberships: a principal can always see their own memberships in the
-- current organization (to derive permitted deals); otherwise deal-scoped.
CREATE POLICY deal_memberships_select ON deal_memberships FOR SELECT TO pactlab_app
  USING (
    organization_id = app_current_organization_id()
    AND (deal_id = ANY (app_current_deal_ids()) OR user_id = app_current_user_id())
  );
CREATE POLICY deal_memberships_insert ON deal_memberships FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
CREATE POLICY deal_memberships_update ON deal_memberships FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));

-- Deal-scoped operational tables.
CREATE POLICY job_runs_tenant ON job_runs FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
CREATE POLICY stored_files_tenant ON stored_files FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));

-- Audit and outbox: organization-level rows (deal_id NULL) or permitted deals.
CREATE POLICY audit_events_select ON audit_events FOR SELECT TO pactlab_app
  USING (
    organization_id = app_current_organization_id()
    AND (deal_id IS NULL OR deal_id = ANY (app_current_deal_ids()))
  );
CREATE POLICY audit_events_insert ON audit_events FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id()
    AND (deal_id IS NULL OR deal_id = ANY (app_current_deal_ids()))
  );
CREATE POLICY outbox_events_select ON outbox_events FOR SELECT TO pactlab_app
  USING (
    organization_id = app_current_organization_id()
    AND (deal_id IS NULL OR deal_id = ANY (app_current_deal_ids()))
  );
CREATE POLICY outbox_events_insert ON outbox_events FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id()
    AND (deal_id IS NULL OR deal_id = ANY (app_current_deal_ids()))
  );

-- ---------------------------------------------------------------------------
-- Object keys must carry the row's tenant and deal prefix.
-- ---------------------------------------------------------------------------
ALTER TABLE stored_files ADD CONSTRAINT stored_files_object_key_tenant_prefix
  CHECK (starts_with(object_key, organization_id::text || '/' || deal_id::text || '/'));

-- ---------------------------------------------------------------------------
-- Tenant-scoped full-text search over deals (RLS filters before ranking).
-- ---------------------------------------------------------------------------
CREATE INDEX deals_search_idx ON deals
  USING GIN (to_tsvector('simple'::regconfig, name || ' ' || target_name));

-- ---------------------------------------------------------------------------
-- Append-only, hash-chained audit trail. One chain per (organization, deal
-- scope); the writer can always see its own chain because inserts pass the
-- same policy as reads.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX audit_events_chain_seq_key ON audit_events
  (organization_id, coalesce(deal_id, '00000000-0000-0000-0000-000000000000'::uuid), chain_seq);

CREATE FUNCTION audit_events_chain() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  previous RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text || ':' || coalesce(NEW.deal_id::text, '-'), 0));
  SELECT a.chain_seq, a.hash INTO previous
    FROM audit_events a
   WHERE a.organization_id = NEW.organization_id
     AND a.deal_id IS NOT DISTINCT FROM NEW.deal_id
   ORDER BY a.chain_seq DESC
   LIMIT 1;
  NEW.chain_seq := coalesce(previous.chain_seq, 0) + 1;
  NEW.prev_hash := previous.hash;
  NEW.occurred_at := date_trunc('milliseconds', clock_timestamp());
  NEW.hash := encode(sha256(convert_to(concat_ws('|',
    coalesce(NEW.prev_hash, ''),
    NEW.chain_seq::text,
    NEW.id::text,
    NEW.organization_id::text,
    coalesce(NEW.deal_id::text, ''),
    coalesce(NEW.actor_user_id::text, ''),
    NEW.action,
    NEW.target_type,
    coalesce(NEW.target_id, ''),
    NEW.outcome,
    coalesce(NEW.request_id, ''),
    to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ), 'UTF8')), 'hex');
  RETURN NEW;
END
$$;

CREATE TRIGGER audit_events_chain BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_chain();

CREATE FUNCTION audit_events_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_events_no_update_delete BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
