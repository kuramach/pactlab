-- Per-organization sign-in method: Auth0 (default) or a Pactlab email
-- one-time code. Expand-only: existing organizations keep AUTH0 and their
-- auth0_organization_id; new columns are nullable or defaulted.
-- See docs/adr/0001-per-organization-sign-in.md.

-- CreateEnum
CREATE TYPE "organization_auth_method" AS ENUM ('AUTH0', 'EMAIL_CODE');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "auth_method" "organization_auth_method" NOT NULL DEFAULT 'AUTH0',
ALTER COLUMN "auth0_organization_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email" TEXT;

-- CreateTable
CREATE TABLE "login_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "ip_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),

    CONSTRAINT "login_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_challenges_user_id_created_at_idx" ON "login_challenges"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "login_challenges_ip_hash_created_at_idx" ON "login_challenges"("ip_hash", "created_at");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_created_at_idx" ON "auth_sessions"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "login_challenges" ADD CONSTRAINT "login_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ADD CONSTRAINT organizations_auth_method_reference
  CHECK ((auth_method = 'AUTH0') = (auth0_organization_id IS NOT NULL));
ALTER TABLE users ADD CONSTRAINT users_email_normalized
  CHECK (email IS NULL OR (email = lower(btrim(email)) AND email LIKE '%_@_%'));
ALTER TABLE login_challenges ADD CONSTRAINT login_challenges_attempts CHECK (attempts BETWEEN 0 AND 5);

-- ---------------------------------------------------------------------------
-- Login state is never reachable by the runtime role directly. Narrow
-- SECURITY DEFINER functions, owned by the no-login role `pactlab_auth`, are
-- the only path. `pactlab_auth` holds column-limited grants and explicit
-- policies, so the functions work identically whether or not the migration
-- role bypasses RLS.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pactlab_auth') THEN
    CREATE ROLE pactlab_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
GRANT pactlab_auth TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO pactlab_auth;

ALTER TABLE login_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;

GRANT SELECT (id, email, auth0_subject, display_name) ON users TO pactlab_auth;
GRANT SELECT (organization_id, user_id, status) ON organization_memberships TO pactlab_auth;
GRANT SELECT (id, auth_method) ON organizations TO pactlab_auth;
GRANT SELECT, INSERT, UPDATE ON login_challenges, auth_sessions TO pactlab_auth;
-- The audit chain trigger reads the previous link of the chain it appends to.
GRANT SELECT, INSERT ON audit_events TO pactlab_auth;

CREATE POLICY users_auth ON users FOR SELECT TO pactlab_auth USING (true);
CREATE POLICY organization_memberships_auth ON organization_memberships FOR SELECT TO pactlab_auth USING (true);
CREATE POLICY organizations_auth ON organizations FOR SELECT TO pactlab_auth USING (true);
CREATE POLICY login_challenges_auth ON login_challenges FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_sessions_auth ON auth_sessions FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY audit_events_auth_select ON audit_events FOR SELECT TO pactlab_auth USING (deal_id IS NULL);
CREATE POLICY audit_events_auth_insert ON audit_events FOR INSERT TO pactlab_auth
  WITH CHECK (deal_id IS NULL AND target_type = 'user' AND (action LIKE 'login.%' OR action = 'session.revoked'));

-- Email-code organizations the user is an active member of.
CREATE FUNCTION app_email_code_organizations(p_user uuid) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT o.id FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = p_user AND m.status = 'ACTIVE' AND o.auth_method = 'EMAIL_CODE'
     ORDER BY o.id
  $$;

-- One audit row per email-code organization of the user (or the given one).
CREATE FUNCTION app_auth_audit(p_user uuid, p_action text, p_outcome text, p_organization uuid DEFAULT NULL)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  org uuid;
BEGIN
  FOR org IN
    SELECT o FROM app_email_code_organizations(p_user) AS o
     WHERE p_organization IS NULL OR o = p_organization
  LOOP
    INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
    VALUES (uuidv7(), org, NULL, p_user, p_action, 'user', p_user::text, p_outcome);
  END LOOP;
END
$$;

-- Start a sign-in. Returns the challenge id when a code should be emailed,
-- NULL otherwise (unknown address, no email-code membership, or rate limit).
-- Callers must respond identically either way.
CREATE FUNCTION app_email_login_begin(p_email text, p_code_hash text, p_ip_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_id uuid := uuidv7();
BEGIN
  SELECT u.id INTO v_user FROM users u
   WHERE u.email = lower(btrim(p_email))
     AND EXISTS (SELECT 1 FROM app_email_code_organizations(u.id));
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;
  IF (SELECT count(*) FROM login_challenges c
       WHERE c.user_id = v_user AND c.created_at > now() - interval '15 minutes') >= 5
     OR (SELECT count(*) FROM login_challenges c
       WHERE c.ip_hash = p_ip_hash AND c.created_at > now() - interval '15 minutes') >= 20 THEN
    PERFORM app_auth_audit(v_user, 'login.code_requested', 'DENIED');
    RETURN NULL;
  END IF;
  -- Only the newest code is ever valid.
  UPDATE login_challenges SET expires_at = now()
   WHERE user_id = v_user AND consumed_at IS NULL AND expires_at > now();
  INSERT INTO login_challenges (id, user_id, code_hash, ip_hash, expires_at)
  VALUES (v_id, v_user, p_code_hash, p_ip_hash, now() + interval '10 minutes');
  PERFORM app_auth_audit(v_user, 'login.code_requested', 'SUCCEEDED');
  RETURN v_id;
END
$$;

-- Complete a sign-in. On a correct, unexpired, unused code within 5 attempts:
-- consume it and open an 8-hour session, scoped when the user has exactly one
-- email-code organization. Returns no row otherwise.
CREATE FUNCTION app_email_login_verify(p_email text, p_code_hash text)
  RETURNS TABLE (session_id uuid, user_id uuid, subject text, organization_id uuid, expires_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_subject text;
  v_challenge login_challenges%ROWTYPE;
  v_orgs uuid[];
  v_session uuid := uuidv7();
  v_expires timestamptz := now() + interval '8 hours';
BEGIN
  SELECT u.id, u.auth0_subject INTO v_user, v_subject FROM users u WHERE u.email = lower(btrim(p_email));
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_challenge FROM login_challenges c
   WHERE c.user_id = v_user AND c.consumed_at IS NULL AND c.expires_at > now() AND c.attempts < 5
   ORDER BY c.created_at DESC LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_auth_audit(v_user, 'login.failed', 'DENIED');
    RETURN;
  END IF;
  IF v_challenge.code_hash <> p_code_hash THEN
    UPDATE login_challenges SET attempts = attempts + 1 WHERE id = v_challenge.id;
    PERFORM app_auth_audit(v_user, 'login.failed', 'DENIED');
    RETURN;
  END IF;
  UPDATE login_challenges SET consumed_at = now() WHERE id = v_challenge.id;
  v_orgs := ARRAY(SELECT app_email_code_organizations(v_user));
  INSERT INTO auth_sessions (id, user_id, organization_id, expires_at)
  VALUES (v_session, v_user, CASE WHEN cardinality(v_orgs) = 1 THEN v_orgs[1] END, v_expires);
  PERFORM app_auth_audit(v_user, 'login.succeeded', 'SUCCEEDED');
  RETURN QUERY SELECT v_session, v_user, v_subject, CASE WHEN cardinality(v_orgs) = 1 THEN v_orgs[1] END, v_expires;
END
$$;

-- Move an active session into one of the user's email-code organizations.
-- The old session is revoked; the new one keeps the original expiry.
CREATE FUNCTION app_auth_session_rescope(p_session uuid, p_organization uuid)
  RETURNS TABLE (session_id uuid, expires_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_old auth_sessions%ROWTYPE;
  v_session uuid := uuidv7();
BEGIN
  SELECT * INTO v_old FROM auth_sessions s
   WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now()
   FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM app_email_code_organizations(v_old.user_id) AS o WHERE o = p_organization
  ) THEN
    RETURN;
  END IF;
  UPDATE auth_sessions SET revoked_at = now() WHERE id = v_old.id;
  INSERT INTO auth_sessions (id, user_id, organization_id, expires_at)
  VALUES (v_session, v_old.user_id, p_organization, v_old.expires_at);
  RETURN QUERY SELECT v_session, v_old.expires_at;
END
$$;

-- True only for an unrevoked, unexpired session matching the token's claims.
CREATE FUNCTION app_auth_session_active(p_session uuid, p_subject text, p_organization uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now()
         AND u.auth0_subject = p_subject
         AND s.organization_id IS NOT DISTINCT FROM p_organization
    )
  $$;

CREATE FUNCTION app_auth_session_revoke(p_session uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_org uuid;
BEGIN
  UPDATE auth_sessions SET revoked_at = now()
   WHERE id = p_session AND revoked_at IS NULL
   RETURNING auth_sessions.user_id, auth_sessions.organization_id INTO v_user, v_org;
  IF v_user IS NOT NULL THEN
    PERFORM app_auth_audit(v_user, 'session.revoked', 'SUCCEEDED', v_org);
  END IF;
END
$$;

ALTER FUNCTION app_email_code_organizations(uuid) OWNER TO pactlab_auth;
ALTER FUNCTION app_auth_audit(uuid, text, text, uuid) OWNER TO pactlab_auth;
ALTER FUNCTION app_email_login_begin(text, text, text) OWNER TO pactlab_auth;
ALTER FUNCTION app_email_login_verify(text, text) OWNER TO pactlab_auth;
ALTER FUNCTION app_auth_session_rescope(uuid, uuid) OWNER TO pactlab_auth;
ALTER FUNCTION app_auth_session_active(uuid, text, uuid) OWNER TO pactlab_auth;
ALTER FUNCTION app_auth_session_revoke(uuid) OWNER TO pactlab_auth;

REVOKE ALL ON FUNCTION
  app_email_code_organizations(uuid),
  app_auth_audit(uuid, text, text, uuid),
  app_email_login_begin(text, text, text),
  app_email_login_verify(text, text),
  app_auth_session_rescope(uuid, uuid),
  app_auth_session_active(uuid, text, uuid),
  app_auth_session_revoke(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app_email_login_begin(text, text, text),
  app_email_login_verify(text, text),
  app_auth_session_rescope(uuid, uuid),
  app_auth_session_active(uuid, text, uuid),
  app_auth_session_revoke(uuid)
TO pactlab_app;
