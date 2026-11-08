-- Passkeys for email-code sign-in (T-108, ADR 0023). Expand-only: two new
-- tables and one nullable column. Like the rest of sign-in state, passkeys
-- belong to users (not tenants) and are reached only through SECURITY DEFINER
-- functions owned by `pactlab_auth`; the runtime role has no table privileges.
-- Functions that act for a signed-in user take the session id and derive the
-- user from it, so a caller can never name someone else's user.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "passkey_offer_dismissed_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "user_passkeys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkey_challenges" (
    "id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "user_id" UUID,
    "challenge" TEXT NOT NULL,
    "ip_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),

    CONSTRAINT "passkey_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_passkeys_credential_id_key" ON "user_passkeys"("credential_id");
CREATE INDEX "user_passkeys_user_id_idx" ON "user_passkeys"("user_id");
CREATE INDEX "passkey_challenges_ip_hash_created_at_idx" ON "passkey_challenges"("ip_hash", "created_at");

-- AddForeignKey
ALTER TABLE "user_passkeys" ADD CONSTRAINT "user_passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "passkey_challenges" ADD CONSTRAINT "passkey_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integrity
-- ---------------------------------------------------------------------------
ALTER TABLE user_passkeys ADD CONSTRAINT user_passkeys_name CHECK (char_length(name) BETWEEN 1 AND 60);
ALTER TABLE user_passkeys ADD CONSTRAINT user_passkeys_counter CHECK (counter >= 0);
ALTER TABLE user_passkeys ADD CONSTRAINT user_passkeys_credential_id CHECK (credential_id ~ '^[A-Za-z0-9_-]+$' AND char_length(credential_id) BETWEEN 16 AND 1366);
ALTER TABLE passkey_challenges ADD CONSTRAINT passkey_challenges_purpose
  CHECK ((purpose = 'SIGN_IN' AND user_id IS NULL AND ip_hash IS NOT NULL) OR (purpose = 'REGISTER' AND user_id IS NOT NULL));

-- ---------------------------------------------------------------------------
-- Access: pactlab_auth only, through the functions below.
-- ---------------------------------------------------------------------------
ALTER TABLE user_passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_passkeys FORCE ROW LEVEL SECURITY;
ALTER TABLE passkey_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE passkey_challenges FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON user_passkeys, passkey_challenges TO pactlab_auth;
GRANT SELECT (passkey_offer_dismissed_at), UPDATE (passkey_offer_dismissed_at) ON users TO pactlab_auth;

CREATE POLICY user_passkeys_auth ON user_passkeys FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY passkey_challenges_auth ON passkey_challenges FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY users_auth_passkey_offer ON users FOR UPDATE TO pactlab_auth USING (true) WITH CHECK (true);

-- The signed-in user behind an active email-code session, and when they signed in.
-- A session keeps its expiry when moved between organizations (rescope), so the sign-in
-- time is the expiry less the 8-hour session length, never the row's created_at.
CREATE FUNCTION app_passkey_account(p_session uuid)
  RETURNS TABLE (user_id uuid, email text, display_name text, signed_in_at timestamptz, offer_dismissed boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT u.id, u.email, u.display_name, s.expires_at - interval '8 hours', u.passkey_offer_dismissed_at IS NOT NULL
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now()
  $$;

-- The session user's active passkeys (never the keys themselves).
CREATE FUNCTION app_passkey_list(p_session uuid)
  RETURNS TABLE (id uuid, credential_id text, transports text[], name text, created_at timestamptz, last_used_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT p.id, p.credential_id, p.transports, p.name, p.created_at, p.last_used_at
      FROM user_passkeys p
     WHERE p.user_id = (SELECT a.user_id FROM app_passkey_account(p_session) a)
       AND p.revoked_at IS NULL
     ORDER BY p.created_at
  $$;

-- A single-use challenge, valid for 5 minutes. SIGN_IN: anyone, at most 30 per address in
-- 15 minutes. REGISTER: only for a session that signed in within the last 15 minutes.
-- NULL when not allowed; callers decide what to say.
CREATE FUNCTION app_passkey_challenge_begin(p_purpose text, p_session uuid, p_challenge text, p_ip_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_id uuid := uuidv7();
  v_user uuid;
  v_signed_in timestamptz;
BEGIN
  IF p_purpose = 'SIGN_IN' THEN
    IF p_ip_hash IS NULL OR (SELECT count(*) FROM passkey_challenges c
         WHERE c.ip_hash = p_ip_hash AND c.created_at > now() - interval '15 minutes') >= 30 THEN
      RETURN NULL;
    END IF;
    INSERT INTO passkey_challenges (id, purpose, user_id, challenge, ip_hash, expires_at)
    VALUES (v_id, 'SIGN_IN', NULL, p_challenge, p_ip_hash, now() + interval '5 minutes');
    RETURN v_id;
  ELSIF p_purpose = 'REGISTER' THEN
    SELECT a.user_id, a.signed_in_at INTO v_user, v_signed_in FROM app_passkey_account(p_session) a;
    IF v_user IS NULL OR v_signed_in < now() - interval '15 minutes' THEN
      RETURN NULL;
    END IF;
    INSERT INTO passkey_challenges (id, purpose, user_id, challenge, ip_hash, expires_at)
    VALUES (v_id, 'REGISTER', v_user, p_challenge, p_ip_hash, now() + interval '5 minutes');
    RETURN v_id;
  END IF;
  RETURN NULL;
END
$$;

-- Consume a challenge (one attempt each) and return it for verification. A REGISTER
-- challenge must belong to the session's user. NULL when unknown, used, expired or mismatched.
CREATE FUNCTION app_passkey_challenge_take(p_id uuid, p_purpose text, p_session uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_row passkey_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM passkey_challenges c
   WHERE c.id = p_id AND c.purpose = p_purpose AND c.consumed_at IS NULL AND c.expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE passkey_challenges SET consumed_at = now() WHERE id = v_row.id;
  IF p_purpose = 'REGISTER' AND v_row.user_id IS DISTINCT FROM (SELECT a.user_id FROM app_passkey_account(p_session) a) THEN
    RETURN NULL;
  END IF;
  RETURN v_row.challenge;
END
$$;

-- Store a verified passkey for the session's user (still within 15 minutes of signing in).
-- At most 10 active per user; a credential is stored once. NULL when refused.
CREATE FUNCTION app_passkey_register(p_session uuid, p_credential_id text, p_public_key bytea, p_counter bigint, p_transports text[], p_name text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_signed_in timestamptz;
  v_id uuid := uuidv7();
BEGIN
  SELECT a.user_id, a.signed_in_at INTO v_user, v_signed_in FROM app_passkey_account(p_session) a;
  IF v_user IS NULL OR v_signed_in < now() - interval '15 minutes' THEN
    RETURN NULL;
  END IF;
  PERFORM 1 FROM users u WHERE u.id = v_user FOR UPDATE;
  IF (SELECT count(*) FROM user_passkeys p WHERE p.user_id = v_user AND p.revoked_at IS NULL) >= 10
     OR EXISTS (SELECT 1 FROM user_passkeys p WHERE p.credential_id = p_credential_id) THEN
    PERFORM app_auth_audit(v_user, 'login.passkey_added', 'DENIED');
    RETURN NULL;
  END IF;
  INSERT INTO user_passkeys (id, user_id, credential_id, public_key, counter, transports, name)
  VALUES (v_id, v_user, p_credential_id, p_public_key, p_counter, coalesce(p_transports, ARRAY[]::text[]), btrim(p_name));
  PERFORM app_auth_audit(v_user, 'login.passkey_added', 'SUCCEEDED');
  RETURN v_id;
END
$$;

-- The stored key for a credential, for signature verification. Only active passkeys of
-- users who can sign in with Pactlab (an email-code organization) are found.
CREATE FUNCTION app_passkey_lookup(p_credential_id text)
  RETURNS TABLE (public_key bytea, counter bigint, transports text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT p.public_key, p.counter, p.transports FROM user_passkeys p
     WHERE p.credential_id = p_credential_id AND p.revoked_at IS NULL
       AND EXISTS (SELECT 1 FROM app_email_code_organizations(p.user_id))
  $$;

-- After the signature verified: check the counter moved forward (an authenticator that
-- never counts stays at 0; a counter that goes backwards suggests a cloned key and is
-- refused), record the use and open the same 8-hour session an email code opens.
CREATE FUNCTION app_passkey_login(p_credential_id text, p_new_counter bigint)
  RETURNS TABLE (session_id uuid, user_id uuid, subject text, organization_id uuid, expires_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_key user_passkeys%ROWTYPE;
  v_subject text;
  v_orgs uuid[];
  v_session uuid := uuidv7();
  v_expires timestamptz := now() + interval '8 hours';
BEGIN
  SELECT * INTO v_key FROM user_passkeys p
   WHERE p.credential_id = p_credential_id AND p.revoked_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF (v_key.counter > 0 OR p_new_counter > 0) AND p_new_counter <= v_key.counter THEN
    PERFORM app_auth_audit(v_key.user_id, 'login.passkey_failed', 'DENIED');
    RETURN;
  END IF;
  v_orgs := ARRAY(SELECT app_email_code_organizations(v_key.user_id));
  IF cardinality(v_orgs) = 0 THEN
    RETURN;
  END IF;
  UPDATE user_passkeys SET counter = p_new_counter, last_used_at = now() WHERE id = v_key.id;
  SELECT u.auth0_subject INTO v_subject FROM users u WHERE u.id = v_key.user_id;
  INSERT INTO auth_sessions (id, user_id, organization_id, expires_at)
  VALUES (v_session, v_key.user_id, CASE WHEN cardinality(v_orgs) = 1 THEN v_orgs[1] END, v_expires);
  PERFORM app_auth_audit(v_key.user_id, 'login.passkey_succeeded', 'SUCCEEDED');
  RETURN QUERY SELECT v_session, v_key.user_id, v_subject, CASE WHEN cardinality(v_orgs) = 1 THEN v_orgs[1] END, v_expires;
END
$$;

-- Remove one of the session user's passkeys. Returns the removed passkey's name, or NULL.
CREATE FUNCTION app_passkey_revoke(p_session uuid, p_id uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid := (SELECT a.user_id FROM app_passkey_account(p_session) a);
  v_name text;
BEGIN
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE user_passkeys SET revoked_at = now()
   WHERE id = p_id AND user_id = v_user AND revoked_at IS NULL
   RETURNING name INTO v_name;
  IF v_name IS NOT NULL THEN
    PERFORM app_auth_audit(v_user, 'login.passkey_removed', 'SUCCEEDED');
  END IF;
  RETURN v_name;
END
$$;

-- "Not now" on the one-time passkey offer.
CREATE FUNCTION app_passkey_offer_dismiss(p_session uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    UPDATE users SET passkey_offer_dismissed_at = now()
     WHERE id = (SELECT a.user_id FROM app_passkey_account(p_session) a) AND passkey_offer_dismissed_at IS NULL
  $$;

ALTER FUNCTION app_passkey_account(uuid) OWNER TO pactlab_auth;
ALTER FUNCTION app_passkey_list(uuid) OWNER TO pactlab_auth;
ALTER FUNCTION app_passkey_challenge_begin(text, uuid, text, text) OWNER TO pactlab_auth;
ALTER FUNCTION app_passkey_challenge_take(uuid, text, uuid) OWNER TO pactlab_auth;
ALTER FUNCTION app_passkey_register(uuid, text, bytea, bigint, text[], text) OWNER TO pactlab_auth;
ALTER FUNCTION app_passkey_lookup(text) OWNER TO pactlab_auth;
ALTER FUNCTION app_passkey_login(text, bigint) OWNER TO pactlab_auth;
ALTER FUNCTION app_passkey_revoke(uuid, uuid) OWNER TO pactlab_auth;
ALTER FUNCTION app_passkey_offer_dismiss(uuid) OWNER TO pactlab_auth;

REVOKE ALL ON FUNCTION
  app_passkey_account(uuid),
  app_passkey_list(uuid),
  app_passkey_challenge_begin(text, uuid, text, text),
  app_passkey_challenge_take(uuid, text, uuid),
  app_passkey_register(uuid, text, bytea, bigint, text[], text),
  app_passkey_lookup(text),
  app_passkey_login(text, bigint),
  app_passkey_revoke(uuid, uuid),
  app_passkey_offer_dismiss(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app_passkey_account(uuid),
  app_passkey_list(uuid),
  app_passkey_challenge_begin(text, uuid, text, text),
  app_passkey_challenge_take(uuid, text, uuid),
  app_passkey_register(uuid, text, bytea, bigint, text[], text),
  app_passkey_lookup(text),
  app_passkey_login(text, bigint),
  app_passkey_revoke(uuid, uuid),
  app_passkey_offer_dismiss(uuid)
TO pactlab_app;
