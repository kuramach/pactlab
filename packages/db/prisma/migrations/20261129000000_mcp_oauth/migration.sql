-- Pactlab as an OAuth 2.1 authorization server for its MCP server (T-084 Part 1, ADR 0024).
-- Expand-only: one flag column, four new tables, new functions and one new audit policy.
-- Like the rest of sign-in state, OAuth state is reached only through SECURITY DEFINER
-- functions owned by `pactlab_auth`; codes and tokens are stored only as hashes.

-- MCP per organization, off until an operator turns it on.
ALTER TABLE "organization_flags" ADD COLUMN "mcp_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Clients registered by Dynamic Client Registration (RFC 7591, the deprecated fallback).
-- Clients using Client ID Metadata Documents are never stored: their URL is their id.
CREATE TABLE "oauth_clients" (
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "redirect_uris" TEXT[] NOT NULL,
    "ip_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("client_id")
);

-- What a person allowed an MCP client to do in one organization.
CREATE TABLE "oauth_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    CONSTRAINT "oauth_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "oauth_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "oauth_grants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "oauth_grants_user_id_idx" ON "oauth_grants"("user_id");

-- Single-use authorization codes, 60 seconds, bound to PKCE, redirect URI and resource.
CREATE TABLE "oauth_codes" (
    "id" UUID NOT NULL,
    "grant_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    CONSTRAINT "oauth_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "oauth_codes_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "oauth_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "oauth_codes_code_hash_key" ON "oauth_codes"("code_hash");

-- Rotating refresh tokens, 30 days. A used token presented again revokes the grant.
CREATE TABLE "oauth_refresh_tokens" (
    "id" UUID NOT NULL,
    "grant_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "scopes" TEXT[] NOT NULL,
    "resource" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    CONSTRAINT "oauth_refresh_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "oauth_refresh_tokens_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "oauth_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "oauth_refresh_tokens_token_hash_key" ON "oauth_refresh_tokens"("token_hash");
CREATE INDEX "oauth_clients_ip_hash_created_at_idx" ON "oauth_clients"("ip_hash", "created_at");

ALTER TABLE oauth_clients ADD CONSTRAINT oauth_clients_name CHECK (char_length(client_name) BETWEEN 1 AND 120);
ALTER TABLE oauth_clients ADD CONSTRAINT oauth_clients_redirects CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10);
ALTER TABLE oauth_grants ADD CONSTRAINT oauth_grants_scopes CHECK (scopes <@ ARRAY['mcp:read', 'mcp:confidential']::text[] AND cardinality(scopes) >= 1);

-- ---------------------------------------------------------------------------
-- Access: pactlab_auth only, through the functions below.
-- ---------------------------------------------------------------------------
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_clients FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_refresh_tokens FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON oauth_clients, oauth_grants, oauth_codes, oauth_refresh_tokens TO pactlab_auth;
GRANT SELECT (organization_id, mcp_enabled) ON organization_flags TO pactlab_auth;
GRANT SELECT (role) ON organization_memberships TO pactlab_auth;
GRANT UPDATE (mcp_enabled) ON organization_flags TO pactlab_ops;

CREATE POLICY oauth_clients_auth ON oauth_clients FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY oauth_grants_auth ON oauth_grants FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY oauth_codes_auth ON oauth_codes FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY oauth_refresh_tokens_auth ON oauth_refresh_tokens FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY organization_flags_auth ON organization_flags FOR SELECT TO pactlab_auth USING (true);
CREATE POLICY audit_events_auth_oauth ON audit_events FOR INSERT TO pactlab_auth
  WITH CHECK (deal_id IS NULL AND target_type = 'user' AND action LIKE 'oauth.%');

-- True when MCP is on for the organization.
CREATE FUNCTION app_oauth_mcp_enabled(p_org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT coalesce((SELECT f.mcp_enabled FROM organization_flags f WHERE f.organization_id = p_org), false) $$;

-- Register a client (DCR). At most 20 registrations per address an hour. False when refused.
CREATE FUNCTION app_oauth_register_client(p_client_id text, p_name text, p_redirect_uris text[], p_ip_hash text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF (SELECT count(*) FROM oauth_clients c WHERE c.ip_hash = p_ip_hash AND c.created_at > now() - interval '1 hour') >= 20 THEN
    RETURN false;
  END IF;
  INSERT INTO oauth_clients (client_id, client_name, redirect_uris, ip_hash) VALUES (p_client_id, btrim(p_name), p_redirect_uris, p_ip_hash);
  RETURN true;
END
$$;

CREATE FUNCTION app_oauth_client(p_client_id text) RETURNS TABLE (client_name text, redirect_uris text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT c.client_name, c.redirect_uris FROM oauth_clients c WHERE c.client_id = p_client_id $$;

-- The person approved: on their active email-code session's organization, with MCP on,
-- record the grant (one active grant per person, organization and client; scopes widen)
-- and a 60-second code. NULL when not allowed.
CREATE FUNCTION app_oauth_authorize(p_session uuid, p_client_id text, p_client_name text, p_scopes text[], p_code_hash text,
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
  IF v_user IS NULL OR v_org IS NULL OR NOT app_oauth_mcp_enabled(v_org)
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

-- Consume a code (one attempt) and return what the token endpoint must check. No row when
-- unknown, used, expired, or its grant was revoked.
CREATE FUNCTION app_oauth_take_code(p_code_hash text)
  RETURNS TABLE (grant_id uuid, user_id uuid, subject text, organization_id uuid, client_id text, scopes text[],
                 code_challenge text, redirect_uri text, resource text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_code oauth_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_code FROM oauth_codes c WHERE c.code_hash = p_code_hash FOR UPDATE;
  IF NOT FOUND OR v_code.consumed_at IS NOT NULL OR v_code.expires_at <= now() THEN
    RETURN;
  END IF;
  UPDATE oauth_codes SET consumed_at = now() WHERE id = v_code.id;
  RETURN QUERY
    SELECT g.id, g.user_id, u.auth0_subject, g.organization_id, g.client_id, v_code.scopes, v_code.code_challenge, v_code.redirect_uri, v_code.resource
      FROM oauth_grants g JOIN users u ON u.id = g.user_id
     WHERE g.id = v_code.grant_id AND g.revoked_at IS NULL;
END
$$;

-- A refresh token for a grant (after a verified code exchange or refresh).
CREATE FUNCTION app_oauth_issue_refresh(p_grant uuid, p_token_hash text, p_scopes text[], p_resource text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_org uuid;
BEGIN
  SELECT g.user_id, g.organization_id INTO v_user, v_org FROM oauth_grants g WHERE g.id = p_grant AND g.revoked_at IS NULL;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO oauth_refresh_tokens (id, grant_id, token_hash, scopes, resource, expires_at)
  VALUES (uuidv7(), p_grant, p_token_hash, p_scopes, p_resource, now() + interval '30 days');
  UPDATE oauth_grants SET last_used_at = now() WHERE id = p_grant;
  PERFORM app_auth_audit(v_user, 'oauth.token_issued', 'SUCCEEDED', v_org);
END
$$;

-- Use a refresh token: valid once. A token presented again (already used) revokes the
-- whole grant, as a stolen-token signal. No row when not usable.
CREATE FUNCTION app_oauth_use_refresh(p_token_hash text)
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
  IF v_token.expires_at <= now() OR v_grant.revoked_at IS NOT NULL OR NOT app_oauth_mcp_enabled(v_grant.organization_id)
     OR NOT EXISTS (SELECT 1 FROM app_email_code_organizations(v_grant.user_id) o WHERE o = v_grant.organization_id) THEN
    RETURN;
  END IF;
  UPDATE oauth_refresh_tokens SET used_at = now() WHERE id = v_token.id;
  RETURN QUERY
    SELECT v_grant.id, v_grant.user_id, u.auth0_subject, v_grant.organization_id, v_grant.client_id, v_token.scopes, v_token.resource
      FROM users u WHERE u.id = v_grant.user_id;
END
$$;

-- For every MCP request: is the grant still usable? `active` false means 401 (revoked, or
-- the person left the organization); `mcp_enabled` false means 403 (switched off).
CREATE FUNCTION app_oauth_grant_state(p_grant uuid, p_subject text)
  RETURNS TABLE (active boolean, mcp_enabled boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_grant oauth_grants%ROWTYPE;
BEGIN
  SELECT g.* INTO v_grant FROM oauth_grants g JOIN users u ON u.id = g.user_id
   WHERE g.id = p_grant AND u.auth0_subject = p_subject;
  IF NOT FOUND OR v_grant.revoked_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM app_email_code_organizations(v_grant.user_id) o WHERE o = v_grant.organization_id) THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;
  IF v_grant.last_used_at IS NULL OR v_grant.last_used_at < now() - interval '5 minutes' THEN
    UPDATE oauth_grants SET last_used_at = now() WHERE id = v_grant.id;
  END IF;
  RETURN QUERY SELECT true, app_oauth_mcp_enabled(v_grant.organization_id);
END
$$;

-- The signed-in person's connected apps, across their organizations.
CREATE FUNCTION app_oauth_grants(p_session uuid)
  RETURNS TABLE (id uuid, organization_id uuid, organization_name text, client_id text, client_name text, scopes text[], created_at timestamptz, last_used_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT g.id, g.organization_id, o.name, g.client_id, g.client_name, g.scopes, g.created_at, g.last_used_at
      FROM oauth_grants g JOIN organizations o ON o.id = g.organization_id
     WHERE g.user_id = (SELECT s.user_id FROM auth_sessions s WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now())
       AND g.revoked_at IS NULL
     ORDER BY g.created_at
  $$;

-- Disconnect one of the signed-in person's apps. False when it is not theirs.
CREATE FUNCTION app_oauth_revoke_grant(p_session uuid, p_grant uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid := (SELECT s.user_id FROM auth_sessions s WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now());
  v_org uuid;
BEGIN
  UPDATE oauth_grants SET revoked_at = now() WHERE id = p_grant AND user_id = v_user AND revoked_at IS NULL
  RETURNING organization_id INTO v_org;
  IF v_org IS NULL THEN
    RETURN false;
  END IF;
  PERFORM app_auth_audit(v_user, 'oauth.grant_revoked', 'SUCCEEDED', v_org);
  RETURN true;
END
$$;

-- RFC 7009: a client revokes its refresh token, which ends the grant.
CREATE FUNCTION app_oauth_revoke_refresh(p_token_hash text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_grant oauth_grants%ROWTYPE;
BEGIN
  SELECT g.* INTO v_grant FROM oauth_refresh_tokens t JOIN oauth_grants g ON g.id = t.grant_id
   WHERE t.token_hash = p_token_hash AND g.revoked_at IS NULL FOR UPDATE OF g;
  IF FOUND THEN
    UPDATE oauth_grants SET revoked_at = now() WHERE id = v_grant.id;
    PERFORM app_auth_audit(v_grant.user_id, 'oauth.grant_revoked', 'SUCCEEDED', v_grant.organization_id);
  END IF;
END
$$;

-- Operators: turn MCP on or off for an organization, and read who has it.
CREATE FUNCTION app_ops_set_mcp(p_actor uuid, p_org uuid, p_enabled boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p_org) THEN RAISE EXCEPTION 'no organization' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO organization_flags (organization_id, mcp_enabled, updated_by, updated_at)
  VALUES (p_org, p_enabled, p_actor, now())
  ON CONFLICT (organization_id) DO UPDATE SET mcp_enabled = EXCLUDED.mcp_enabled, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM app_ops_audit(p_actor, p_org, CASE WHEN p_enabled THEN 'org.mcp_enabled' ELSE 'org.mcp_disabled' END, 'organization', p_org);
END
$$;

CREATE FUNCTION app_ops_mcp_organizations(p_actor uuid) RETURNS TABLE (organization_id uuid, mcp_enabled boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY SELECT o.id, coalesce(f.mcp_enabled, false) FROM organizations o LEFT JOIN organization_flags f ON f.organization_id = o.id;
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_oauth_mcp_enabled(uuid)', 'app_oauth_register_client(text, text, text[], text)', 'app_oauth_client(text)',
    'app_oauth_authorize(uuid, text, text, text[], text, text, text, text)', 'app_oauth_take_code(text)',
    'app_oauth_issue_refresh(uuid, text, text[], text)', 'app_oauth_use_refresh(text)', 'app_oauth_grant_state(uuid, text)',
    'app_oauth_grants(uuid)', 'app_oauth_revoke_grant(uuid, uuid)', 'app_oauth_revoke_refresh(text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_auth', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['app_ops_set_mcp(uuid, uuid, boolean)', 'app_ops_mcp_organizations(uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
