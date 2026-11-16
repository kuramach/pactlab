-- API access per person (T-128, ADR 0024 addendum): the REST API becomes a second protected
-- resource of Pactlab's OAuth server, beside the MCP server. Scopes api:read (default) and
-- api:write; scripts sign in with the device authorization grant (RFC 8628). An organization
-- switch (on by default) lets its admins turn API access off; admins also see and revoke their
-- members' grants. Expand-only; rollback: drop oauth_device_codes and the new functions, put the
-- old scope check back, drop organization_flags.api_enabled. Re-runnable.
BEGIN;

ALTER TABLE organization_flags ADD COLUMN IF NOT EXISTS "api_enabled" BOOLEAN NOT NULL DEFAULT true;
GRANT SELECT (api_enabled, updated_by, updated_at) ON organization_flags TO pactlab_auth;
GRANT UPDATE (api_enabled) ON organization_flags TO pactlab_ops;

ALTER TABLE oauth_grants DROP CONSTRAINT IF EXISTS oauth_grants_scopes;
ALTER TABLE oauth_grants ADD CONSTRAINT oauth_grants_scopes
  CHECK (scopes <@ ARRAY['mcp:read', 'mcp:confidential', 'mcp:propose', 'api:read', 'api:write']::text[] AND cardinality(scopes) >= 1);

-- Device authorization (RFC 8628): a script asks for a code, the person approves it signed in,
-- the script polls for its tokens. Ten minutes; the device code is stored only as a hash.
CREATE TABLE IF NOT EXISTS "oauth_device_codes" (
    "id" UUID NOT NULL,
    "device_code_hash" CHAR(64) NOT NULL,
    "user_code" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL,
    "resource" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "grant_id" UUID,
    "ip_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_polled_at" TIMESTAMPTZ(3),
    CONSTRAINT "oauth_device_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "oauth_device_codes_status" CHECK ("status" IN ('PENDING', 'APPROVED', 'DENIED', 'CONSUMED')),
    CONSTRAINT "oauth_device_codes_user_code" CHECK ("user_code" ~ '^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$'),
    CONSTRAINT "oauth_device_codes_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "oauth_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_device_codes_hash_key" ON "oauth_device_codes"("device_code_hash");
CREATE INDEX IF NOT EXISTS "oauth_device_codes_user_code_idx" ON "oauth_device_codes"("user_code");
CREATE INDEX IF NOT EXISTS "oauth_device_codes_ip_idx" ON "oauth_device_codes"("ip_hash", "created_at");
ALTER TABLE oauth_device_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_device_codes FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON oauth_device_codes TO pactlab_auth;
DROP POLICY IF EXISTS oauth_device_codes_auth ON oauth_device_codes;
CREATE POLICY oauth_device_codes_auth ON oauth_device_codes FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);

-- True when API access is on for the organization (on unless an admin turned it off).
CREATE OR REPLACE FUNCTION app_oauth_api_enabled(p_org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT coalesce((SELECT f.api_enabled FROM organization_flags f WHERE f.organization_id = p_org), true) $$;

-- Whether the resource a grant's scopes are for is switched on: API scopes need API access on,
-- MCP scopes need MCP on.
CREATE OR REPLACE FUNCTION app_oauth_scopes_enabled(p_org uuid, p_scopes text[]) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT (NOT EXISTS (SELECT 1 FROM unnest(p_scopes) s WHERE s LIKE 'mcp:%') OR app_oauth_mcp_enabled(p_org))
       AND (NOT EXISTS (SELECT 1 FROM unnest(p_scopes) s WHERE s LIKE 'api:%') OR app_oauth_api_enabled(p_org))
  $$;

-- Authorization (code flow) now serves either resource: the scopes say which switch applies.
CREATE OR REPLACE FUNCTION app_oauth_authorize(p_session uuid, p_client_id text, p_client_name text, p_scopes text[], p_code_hash text,
                                               p_code_challenge text, p_redirect_uri text, p_resource text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_org uuid;
  v_grant uuid;
BEGIN
  SELECT s.user_id, s.organization_id INTO v_user, v_org FROM auth_sessions s
   WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now();
  IF v_user IS NULL OR v_org IS NULL OR NOT app_oauth_scopes_enabled(v_org, p_scopes)
     OR NOT EXISTS (SELECT 1 FROM app_email_code_organizations(v_user) o WHERE o = v_org) THEN
    RETURN NULL;
  END IF;
  SELECT g.id INTO v_grant FROM oauth_grants g
   WHERE g.user_id = v_user AND g.organization_id = v_org AND g.client_id = p_client_id AND g.revoked_at IS NULL
   FOR UPDATE;
  IF v_grant IS NULL THEN
    v_grant := uuidv7();
    INSERT INTO oauth_grants (id, user_id, organization_id, client_id, client_name, scopes) VALUES (v_grant, v_user, v_org, p_client_id, btrim(p_client_name), p_scopes);
  ELSE
    UPDATE oauth_grants SET scopes = ARRAY(SELECT DISTINCT unnest(scopes || p_scopes) ORDER BY 1), client_name = btrim(p_client_name) WHERE id = v_grant;
  END IF;
  INSERT INTO oauth_codes (id, grant_id, code_hash, code_challenge, redirect_uri, resource, scopes, expires_at)
  VALUES (uuidv7(), v_grant, p_code_hash, p_code_challenge, p_redirect_uri, p_resource, p_scopes, now() + interval '60 seconds');
  PERFORM app_auth_audit(v_user, 'oauth.grant_created', 'SUCCEEDED', v_org);
  RETURN v_grant;
END
$$;

-- Refresh: as before, with the switch for the token's own scopes.
CREATE OR REPLACE FUNCTION app_oauth_use_refresh(p_token_hash text)
  RETURNS TABLE (grant_id uuid, user_id uuid, subject text, organization_id uuid, client_id text, scopes text[], resource text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_token oauth_refresh_tokens%ROWTYPE;
  v_grant oauth_grants%ROWTYPE;
BEGIN
  SELECT * INTO v_token FROM oauth_refresh_tokens t WHERE t.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO v_grant FROM oauth_grants g WHERE g.id = v_token.grant_id FOR UPDATE;
  IF v_token.used_at IS NOT NULL THEN
    IF v_grant.revoked_at IS NULL THEN
      UPDATE oauth_grants SET revoked_at = now() WHERE id = v_grant.id;
      PERFORM app_auth_audit(v_grant.user_id, 'oauth.refresh_reused', 'DENIED', v_grant.organization_id);
    END IF;
    RETURN;
  END IF;
  IF v_token.expires_at <= now() OR v_grant.revoked_at IS NOT NULL OR NOT app_oauth_scopes_enabled(v_grant.organization_id, v_token.scopes)
     OR NOT EXISTS (SELECT 1 FROM app_email_code_organizations(v_grant.user_id) o WHERE o = v_grant.organization_id) THEN
    RETURN;
  END IF;
  UPDATE oauth_refresh_tokens SET used_at = now() WHERE id = v_token.id;
  RETURN QUERY
    SELECT v_grant.id, v_grant.user_id, u.auth0_subject, v_grant.organization_id, v_grant.client_id, v_token.scopes, v_token.resource
      FROM users u WHERE u.id = v_grant.user_id;
END
$$;

-- For every API or MCP request: is the grant usable, and is each resource switched on?
-- (A new function so the running release keeps app_oauth_grant_state as it is.)
CREATE OR REPLACE FUNCTION app_oauth_grant_access(p_grant uuid, p_subject text)
  RETURNS TABLE (active boolean, mcp_enabled boolean, api_enabled boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_grant oauth_grants%ROWTYPE;
BEGIN
  SELECT g.* INTO v_grant FROM oauth_grants g JOIN users u ON u.id = g.user_id
   WHERE g.id = p_grant AND u.auth0_subject = p_subject;
  IF NOT FOUND OR v_grant.revoked_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM app_email_code_organizations(v_grant.user_id) o WHERE o = v_grant.organization_id) THEN
    RETURN QUERY SELECT false, false, false;
    RETURN;
  END IF;
  IF v_grant.last_used_at IS NULL OR v_grant.last_used_at < now() - interval '1 minute' THEN
    UPDATE oauth_grants SET last_used_at = now() WHERE id = v_grant.id;
  END IF;
  RETURN QUERY SELECT true, app_oauth_mcp_enabled(v_grant.organization_id), app_oauth_api_enabled(v_grant.organization_id);
END
$$;

-- Device flow, step 1: a script asks for a code. At most 30 a hour per address. False when refused.
CREATE OR REPLACE FUNCTION app_oauth_device_start(p_client_id text, p_client_name text, p_scopes text[], p_resource text,
                                                  p_device_hash text, p_user_code text, p_ip_hash text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF (SELECT count(*) FROM oauth_device_codes d WHERE d.ip_hash = p_ip_hash AND d.created_at > now() - interval '1 hour') >= 30 THEN
    RETURN false;
  END IF;
  INSERT INTO oauth_device_codes (id, device_code_hash, user_code, client_id, client_name, scopes, resource, ip_hash, expires_at)
  VALUES (uuidv7(), p_device_hash, p_user_code, p_client_id, btrim(p_client_name), p_scopes, p_resource, p_ip_hash, now() + interval '10 minutes');
  RETURN true;
END
$$;

-- Device flow, the approval page: what a pending code asks for (nothing when unknown, used or expired).
CREATE OR REPLACE FUNCTION app_oauth_device_lookup(p_user_code text)
  RETURNS TABLE (client_id text, client_name text, scopes text[], resource text, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT d.client_id, d.client_name, d.scopes, d.resource, d.expires_at::timestamptz FROM oauth_device_codes d
     WHERE d.user_code = p_user_code AND d.status = 'PENDING' AND d.expires_at > now()
     ORDER BY d.created_at DESC LIMIT 1
  $$;

-- Device flow, the person's decision on their session's organization. The grant id when
-- approved, NULL otherwise (declined, unknown, expired, switched off, not a member).
CREATE OR REPLACE FUNCTION app_oauth_device_decide(p_session uuid, p_user_code text, p_approve boolean) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_org uuid;
  v_code oauth_device_codes%ROWTYPE;
  v_grant uuid;
BEGIN
  SELECT s.user_id, s.organization_id INTO v_user, v_org FROM auth_sessions s
   WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now();
  SELECT * INTO v_code FROM oauth_device_codes d
   WHERE d.user_code = p_user_code AND d.status = 'PENDING' AND d.expires_at > now()
   ORDER BY d.created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_user IS NULL OR v_org IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT p_approve THEN
    UPDATE oauth_device_codes SET status = 'DENIED' WHERE id = v_code.id;
    RETURN NULL;
  END IF;
  IF NOT app_oauth_scopes_enabled(v_org, v_code.scopes)
     OR NOT EXISTS (SELECT 1 FROM app_email_code_organizations(v_user) o WHERE o = v_org) THEN
    RETURN NULL;
  END IF;
  SELECT g.id INTO v_grant FROM oauth_grants g
   WHERE g.user_id = v_user AND g.organization_id = v_org AND g.client_id = v_code.client_id AND g.revoked_at IS NULL
   FOR UPDATE;
  IF v_grant IS NULL THEN
    v_grant := uuidv7();
    INSERT INTO oauth_grants (id, user_id, organization_id, client_id, client_name, scopes) VALUES (v_grant, v_user, v_org, v_code.client_id, v_code.client_name, v_code.scopes);
  ELSE
    UPDATE oauth_grants SET scopes = ARRAY(SELECT DISTINCT unnest(scopes || v_code.scopes) ORDER BY 1) WHERE id = v_grant;
  END IF;
  UPDATE oauth_device_codes SET status = 'APPROVED', grant_id = v_grant WHERE id = v_code.id;
  PERFORM app_auth_audit(v_user, 'oauth.grant_created', 'SUCCEEDED', v_org);
  RETURN v_grant;
END
$$;

-- Device flow, polling: PENDING, SLOW_DOWN (polled within 5 seconds), DENIED, EXPIRED, or
-- APPROVED with the grant (once: the code is then consumed). UNKNOWN for anything else.
CREATE OR REPLACE FUNCTION app_oauth_device_poll(p_device_hash text)
  RETURNS TABLE (outcome text, grant_id uuid, user_id uuid, subject text, organization_id uuid, client_id text, scopes text[], resource text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_code oauth_device_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_code FROM oauth_device_codes d WHERE d.device_code_hash = p_device_hash FOR UPDATE;
  IF NOT FOUND OR v_code.status = 'CONSUMED' THEN
    RETURN QUERY SELECT 'UNKNOWN'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::text[], NULL::text;
    RETURN;
  END IF;
  IF v_code.status = 'DENIED' THEN
    RETURN QUERY SELECT 'DENIED'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::text[], NULL::text;
    RETURN;
  END IF;
  IF v_code.expires_at <= now() THEN
    RETURN QUERY SELECT 'EXPIRED'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::text[], NULL::text;
    RETURN;
  END IF;
  IF v_code.status = 'PENDING' THEN
    IF v_code.last_polled_at IS NOT NULL AND v_code.last_polled_at > now() - interval '5 seconds' THEN
      UPDATE oauth_device_codes SET last_polled_at = now() WHERE id = v_code.id;
      RETURN QUERY SELECT 'SLOW_DOWN'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::text[], NULL::text;
      RETURN;
    END IF;
    UPDATE oauth_device_codes SET last_polled_at = now() WHERE id = v_code.id;
    RETURN QUERY SELECT 'PENDING'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::text[], NULL::text;
    RETURN;
  END IF;
  UPDATE oauth_device_codes SET status = 'CONSUMED' WHERE id = v_code.id;
  RETURN QUERY
    SELECT 'APPROVED'::text, g.id, g.user_id, u.auth0_subject, g.organization_id, g.client_id, v_code.scopes, v_code.resource
      FROM oauth_grants g JOIN users u ON u.id = g.user_id
     WHERE g.id = v_code.grant_id AND g.revoked_at IS NULL;
END
$$;

-- Organization admins: API access on or off, and every member's API grants (with revoke).
CREATE OR REPLACE FUNCTION app_oauth_admin_org(p_session uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT s.organization_id FROM auth_sessions s
      JOIN organization_memberships m ON m.user_id = s.user_id AND m.organization_id = s.organization_id
     WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now()
       AND m.status = 'ACTIVE' AND m.role IN ('ORG_OWNER', 'ORG_ADMIN')
  $$;

CREATE OR REPLACE FUNCTION app_oauth_set_api_enabled(p_session uuid, p_enabled boolean) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_org uuid := app_oauth_admin_org(p_session);
  v_user uuid := (SELECT s.user_id FROM auth_sessions s WHERE s.id = p_session);
BEGIN
  IF v_org IS NULL THEN RETURN false; END IF;
  INSERT INTO organization_flags (organization_id, api_enabled, updated_by, updated_at) VALUES (v_org, p_enabled, v_user, now())
  ON CONFLICT (organization_id) DO UPDATE SET api_enabled = EXCLUDED.api_enabled, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM app_auth_audit(v_user, CASE WHEN p_enabled THEN 'oauth.api_enabled' ELSE 'oauth.api_disabled' END, 'SUCCEEDED', v_org);
  RETURN true;
END
$$;

-- Every member's grants with API scopes, newest first, a page at a time (T-126). NULL org: not an admin.
CREATE OR REPLACE FUNCTION app_oauth_org_api_grants(p_session uuid, p_after_at timestamptz, p_after_id uuid, p_limit integer)
  RETURNS TABLE (id uuid, user_name text, user_email text, client_id text, client_name text, scopes text[], created_at timestamptz, last_used_at timestamptz, total bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_org uuid := app_oauth_admin_org(p_session);
BEGIN
  IF v_org IS NULL THEN RETURN; END IF;
  RETURN QUERY
    WITH matching AS (
      SELECT g.* FROM oauth_grants g
       WHERE g.organization_id = v_org AND g.revoked_at IS NULL AND EXISTS (SELECT 1 FROM unnest(g.scopes) s WHERE s LIKE 'api:%')
    )
    SELECT g.id, u.display_name, u.email, g.client_id, g.client_name, g.scopes, g.created_at::timestamptz, g.last_used_at::timestamptz, (SELECT count(*) FROM matching)
      FROM matching g JOIN users u ON u.id = g.user_id
     WHERE p_after_at IS NULL OR (g.created_at, g.id) < (p_after_at, p_after_id)
     ORDER BY g.created_at DESC, g.id DESC
     LIMIT least(greatest(coalesce(p_limit, 51), 1), 101);
END
$$;

CREATE OR REPLACE FUNCTION app_oauth_admin_revoke(p_session uuid, p_grant uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_org uuid := app_oauth_admin_org(p_session);
  v_user uuid := (SELECT s.user_id FROM auth_sessions s WHERE s.id = p_session);
  v_revoked uuid;
BEGIN
  IF v_org IS NULL THEN RETURN false; END IF;
  UPDATE oauth_grants SET revoked_at = now() WHERE id = p_grant AND organization_id = v_org AND revoked_at IS NULL RETURNING id INTO v_revoked;
  IF v_revoked IS NULL THEN RETURN false; END IF;
  PERFORM app_auth_audit(v_user, 'oauth.grant_revoked', 'SUCCEEDED', v_org);
  RETURN true;
END
$$;

GRANT SELECT (role, status, user_id, organization_id) ON organization_memberships TO pactlab_auth;
GRANT INSERT (organization_id, api_enabled, updated_by, updated_at), UPDATE (api_enabled, updated_by, updated_at) ON organization_flags TO pactlab_auth;
DROP POLICY IF EXISTS organization_flags_auth_write ON organization_flags;
CREATE POLICY organization_flags_auth_write ON organization_flags FOR INSERT TO pactlab_auth WITH CHECK (true);
DROP POLICY IF EXISTS organization_flags_auth_update ON organization_flags;
CREATE POLICY organization_flags_auth_update ON organization_flags FOR UPDATE TO pactlab_auth USING (true) WITH CHECK (true);

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_oauth_api_enabled(uuid)', 'app_oauth_scopes_enabled(uuid, text[])', 'app_oauth_grant_access(uuid, text)',
    'app_oauth_device_start(text, text, text[], text, text, text, text)', 'app_oauth_device_lookup(text)', 'app_oauth_device_decide(uuid, text, boolean)',
    'app_oauth_device_poll(text)', 'app_oauth_admin_org(uuid)', 'app_oauth_set_api_enabled(uuid, boolean)',
    'app_oauth_org_api_grants(uuid, timestamptz, uuid, integer)', 'app_oauth_admin_revoke(uuid, uuid)',
    'app_oauth_authorize(uuid, text, text, text[], text, text, text, text)', 'app_oauth_use_refresh(text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_auth', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;

COMMIT;
