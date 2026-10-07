-- Self-serve sign-up with email codes and operator approval (ADR 0002).
-- Expand-only: existing organizations become ACTIVE / OPERATOR by default.

-- CreateEnum
CREATE TYPE "organization_status" AS ENUM ('ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "organization_origin" AS ENUM ('OPERATOR', 'SIGNUP');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "created_via" "organization_origin" NOT NULL DEFAULT 'OPERATOR',
ADD COLUMN     "sso_requested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "organization_status" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "signup_challenges" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "organization_name" TEXT NOT NULL,
    "sso_requested" BOOLEAN NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "ip_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "organization_id" UUID,

    CONSTRAINT "signup_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signup_challenges_email_created_at_idx" ON "signup_challenges"("email", "created_at");

-- CreateIndex
CREATE INDEX "signup_challenges_ip_hash_created_at_idx" ON "signup_challenges"("ip_hash", "created_at");


-- ---------------------------------------------------------------------------
-- Integrity
-- ---------------------------------------------------------------------------
ALTER TABLE signup_challenges ADD CONSTRAINT signup_challenges_email_normalized
  CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%');
ALTER TABLE signup_challenges ADD CONSTRAINT signup_challenges_names
  CHECK (length(btrim(display_name)) BETWEEN 1 AND 120 AND length(btrim(organization_name)) BETWEEN 2 AND 120);
ALTER TABLE signup_challenges ADD CONSTRAINT signup_challenges_attempts CHECK (attempts BETWEEN 0 AND 5);

-- ---------------------------------------------------------------------------
-- Privileges: like login state, sign-up state is reachable only through
-- SECURITY DEFINER functions owned by `pactlab_auth`. Sign-up is the one
-- path that creates organizations, users and owner memberships without an
-- operator, so `pactlab_auth` gets narrow INSERT rights with policies that
-- allow only what sign-up creates.
-- ---------------------------------------------------------------------------
ALTER TABLE signup_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE signup_challenges FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON signup_challenges TO pactlab_auth;
CREATE POLICY signup_challenges_auth ON signup_challenges FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);

GRANT SELECT (status, slug) ON organizations TO pactlab_auth;
GRANT INSERT (id, name, slug, auth_method, status, sso_requested, created_via, updated_at) ON organizations TO pactlab_auth;
GRANT INSERT (id, auth0_subject, display_name, email) ON users TO pactlab_auth;
GRANT INSERT (id, organization_id, user_id, role) ON organization_memberships TO pactlab_auth;

CREATE POLICY organizations_auth_signup ON organizations FOR INSERT TO pactlab_auth
  WITH CHECK (auth_method = 'EMAIL_CODE' AND created_via = 'SIGNUP' AND status IN ('PENDING_APPROVAL', 'ACTIVE'));
CREATE POLICY users_auth_signup ON users FOR INSERT TO pactlab_auth
  WITH CHECK (auth0_subject = 'pactlab|' || id::text AND email IS NOT NULL);
CREATE POLICY organization_memberships_auth_signup ON organization_memberships FOR INSERT TO pactlab_auth
  WITH CHECK (role = 'ORG_OWNER');
CREATE POLICY audit_events_auth_signup ON audit_events FOR INSERT TO pactlab_auth
  WITH CHECK (deal_id IS NULL AND target_type = 'organization' AND action = 'org.signup');

-- Only ACTIVE organizations can be entered with an email code.
CREATE OR REPLACE FUNCTION app_email_code_organizations(p_user uuid) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT o.id FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = p_user AND m.status = 'ACTIVE' AND o.auth_method = 'EMAIL_CODE' AND o.status = 'ACTIVE'
     ORDER BY o.id
  $$;

-- Start a sign-up. Returns the challenge id and whether the address already
-- belongs to a user (who is then emailed a "log in instead" note, not a
-- code). Returns no row when rate limited. Callers respond identically.
CREATE FUNCTION app_signup_begin(
  p_email text, p_display_name text, p_organization_name text, p_sso_requested boolean,
  p_code_hash text, p_ip_hash text
) RETURNS TABLE (challenge_id uuid, existing_user boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_email text := lower(btrim(p_email));
  v_id uuid := uuidv7();
BEGIN
  IF (SELECT count(*) FROM signup_challenges c WHERE c.email = v_email AND c.created_at > now() - interval '1 hour') >= 3
     OR (SELECT count(*) FROM signup_challenges c WHERE c.ip_hash = p_ip_hash AND c.created_at > now() - interval '1 hour') >= 10 THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE u.email = v_email) THEN
    RETURN QUERY SELECT NULL::uuid, true;
    RETURN;
  END IF;
  UPDATE signup_challenges SET expires_at = now()
   WHERE email = v_email AND consumed_at IS NULL AND expires_at > now();
  INSERT INTO signup_challenges (id, email, display_name, organization_name, sso_requested, code_hash, ip_hash, expires_at)
  VALUES (v_id, v_email, btrim(p_display_name), btrim(p_organization_name), p_sso_requested, p_code_hash, p_ip_hash,
          now() + interval '10 minutes');
  RETURN QUERY SELECT v_id, false;
END
$$;

-- Complete a sign-up: on a correct, unexpired, unused code within 5 attempts,
-- create the organization (email-code sign-in), the user and an owner
-- membership in one transaction. Returns no row otherwise.
CREATE FUNCTION app_signup_verify(p_email text, p_code_hash text, p_requires_approval boolean)
  RETURNS TABLE (organization_id uuid, slug text, status organization_status, owner_user_id uuid,
                 organization_name text, owner_name text, sso_requested boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_email text := lower(btrim(p_email));
  v_challenge signup_challenges%ROWTYPE;
  v_org uuid := uuidv7();
  v_user uuid := uuidv7();
  v_slug text;
  v_status organization_status := CASE WHEN p_requires_approval THEN 'PENDING_APPROVAL' ELSE 'ACTIVE' END;
BEGIN
  SELECT * INTO v_challenge FROM signup_challenges c
   WHERE c.email = v_email AND c.consumed_at IS NULL AND c.expires_at > now() AND c.attempts < 5
   ORDER BY c.created_at DESC LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_challenge.code_hash <> p_code_hash THEN
    UPDATE signup_challenges SET attempts = attempts + 1 WHERE id = v_challenge.id;
    RETURN;
  END IF;
  -- The address was claimed between start and verify: no second account.
  IF EXISTS (SELECT 1 FROM users u WHERE u.email = v_email) THEN
    UPDATE signup_challenges SET consumed_at = now() WHERE id = v_challenge.id;
    RETURN;
  END IF;

  v_slug := left(btrim(regexp_replace(lower(v_challenge.organization_name), '[^a-z0-9]+', '-', 'g'), '-'), 40);
  v_slug := CASE WHEN v_slug = '' THEN 'org' ELSE v_slug END || '-' || right(replace(v_org::text, '-', ''), 6);

  INSERT INTO organizations (id, name, slug, auth_method, status, sso_requested, created_via, updated_at)
  VALUES (v_org, v_challenge.organization_name, v_slug, 'EMAIL_CODE', v_status, v_challenge.sso_requested, 'SIGNUP', now());
  INSERT INTO users (id, auth0_subject, display_name, email)
  VALUES (v_user, 'pactlab|' || v_user::text, v_challenge.display_name, v_email);
  INSERT INTO organization_memberships (id, organization_id, user_id, role)
  VALUES (uuidv7(), v_org, v_user, 'ORG_OWNER');
  UPDATE signup_challenges SET consumed_at = now(), organization_id = v_org WHERE id = v_challenge.id;
  INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
  VALUES (uuidv7(), v_org, NULL, v_user, 'org.signup', 'organization', v_org::text, 'SUCCEEDED');

  RETURN QUERY SELECT v_org, v_slug, v_status, v_user, v_challenge.organization_name, v_challenge.display_name,
                      v_challenge.sso_requested;
END
$$;

ALTER FUNCTION app_signup_begin(text, text, text, boolean, text, text) OWNER TO pactlab_auth;
ALTER FUNCTION app_signup_verify(text, text, boolean) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_signup_begin(text, text, text, boolean, text, text), app_signup_verify(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_signup_begin(text, text, text, boolean, text, text), app_signup_verify(text, text, boolean) TO pactlab_app;
