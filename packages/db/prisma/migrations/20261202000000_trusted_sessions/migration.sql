-- Trusted devices (T-112, ADR 0027): a person may keep a Pactlab sign-in for 1 day, 1 week or
-- 30 days on a device they trust, within the organization's cap, ending after 24 idle hours.
-- Expand-only: new columns with defaults (old function versions keep working) and new
-- functions; app_auth_session_active stays for a rolling deploy.
-- Rollback: drop the new functions and columns, restore the previous rescope and
-- passkey_account bodies (20261111000000_pact_guests, 20261128000000_passkeys).

-- 1. When the person actually signed in (kept across a move between organizations), whether
--    they trusted this device, when the session was last used, and a readable device name.
ALTER TABLE "auth_sessions"
  ADD COLUMN "signed_in_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "trusted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "device_label" TEXT,
  ADD CONSTRAINT "auth_sessions_device_label_check" CHECK (char_length("device_label") <= 80);
-- Every session so far was 8 hours long.
UPDATE auth_sessions SET signed_in_at = expires_at - interval '8 hours', last_seen_at = now();
CREATE INDEX "auth_sessions_user_id_expires_at_idx" ON "auth_sessions"("user_id", "expires_at");

-- 2. The organization's cap on a trusted sign-in, in hours: 0 (off), 1 day, 1 week, 30 days.
ALTER TABLE "organizations" ADD COLUMN "trusted_session_max_hours" INTEGER NOT NULL DEFAULT 168,
  ADD CONSTRAINT "organizations_trusted_session_max_hours_check" CHECK ("trusted_session_max_hours" IN (0, 24, 168, 720));
-- Organization admins change it (the existing organizations_admin_update policy checks the role).
GRANT UPDATE ("trusted_session_max_hours", "updated_at") ON organizations TO pactlab_app;
GRANT SELECT ("trusted_session_max_hours") ON organizations TO pactlab_auth;

-- 3. pactlab_auth may audit every session event.
DROP POLICY audit_events_auth_insert ON audit_events;
CREATE POLICY audit_events_auth_insert ON audit_events FOR INSERT TO pactlab_auth
  WITH CHECK (deal_id IS NULL AND target_type = 'user' AND (action LIKE 'login.%' OR action LIKE 'session.%'));

-- The longest a trusted session may run for an organization; no organization yet: 30 days.
CREATE FUNCTION app_auth_trust_cap(p_organization uuid) RETURNS interval
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT CASE
      WHEN p_organization IS NULL THEN interval '720 hours'
      ELSE make_interval(hours => greatest(8, coalesce((SELECT o.trusted_session_max_hours FROM organizations o WHERE o.id = p_organization), 0)))
    END
  $$;

-- 4. Trust the device a session was just opened on: once, within 2 minutes of signing in.
--    The length is clamped to 30 days and to the organization's cap.
CREATE FUNCTION app_auth_session_trust(p_session uuid, p_hours integer, p_device text)
  RETURNS timestamptz
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_row auth_sessions%ROWTYPE;
  v_expires timestamptz;
BEGIN
  IF p_hours NOT IN (24, 168, 720) THEN RETURN NULL; END IF;
  SELECT * INTO v_row FROM auth_sessions s
   WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now()
     AND NOT s.trusted AND s.signed_in_at > now() - interval '2 minutes'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_expires := v_row.signed_in_at + least(make_interval(hours => p_hours), app_auth_trust_cap(v_row.organization_id));
  IF v_expires <= v_row.expires_at THEN RETURN v_row.expires_at; END IF;
  UPDATE auth_sessions
     SET trusted = true, expires_at = v_expires, last_seen_at = now(), device_label = left(nullif(btrim(p_device), ''), 80)
   WHERE id = v_row.id;
  PERFORM app_auth_audit(v_row.user_id, 'session.trusted', 'SUCCEEDED', v_row.organization_id);
  RETURN v_expires;
END
$$;

-- 5. Every request: the session is live, and when trusted, still within the organization's
--    (current) cap and used in the last 24 hours. Returns when the person signed in.
CREATE FUNCTION app_auth_session_check(p_session uuid, p_subject text, p_organization uuid)
  RETURNS TABLE (signed_in_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_row auth_sessions%ROWTYPE;
BEGIN
  SELECT s.* INTO v_row FROM auth_sessions s JOIN users u ON u.id = s.user_id
   WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now()
     AND u.auth0_subject = p_subject
     AND s.organization_id IS NOT DISTINCT FROM p_organization;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_row.trusted AND (
    v_row.last_seen_at <= now() - interval '24 hours'
    OR v_row.signed_in_at + app_auth_trust_cap(v_row.organization_id) <= now()
  ) THEN
    RETURN;
  END IF;
  -- At most one write every 5 minutes per session.
  IF v_row.last_seen_at < now() - interval '5 minutes' THEN
    UPDATE auth_sessions SET last_seen_at = now() WHERE id = v_row.id;
  END IF;
  RETURN QUERY SELECT v_row.signed_in_at;
END
$$;

-- The live sessions of the person behind p_session (a trusted one also within its idle window and cap).
CREATE FUNCTION app_auth_live_sessions(p_session uuid) RETURNS SETOF auth_sessions
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT s.* FROM auth_sessions s
     WHERE s.user_id = (SELECT c.user_id FROM auth_sessions c WHERE c.id = p_session AND c.revoked_at IS NULL AND c.expires_at > now())
       AND s.revoked_at IS NULL AND s.expires_at > now()
       AND (NOT s.trusted OR (s.last_seen_at > now() - interval '24 hours' AND s.signed_in_at + app_auth_trust_cap(s.organization_id) > now()))
  $$;

-- 6. The signed-in devices of the person behind p_session, newest first.
CREATE FUNCTION app_auth_sessions_list(p_session uuid)
  RETURNS TABLE (id uuid, device_label text, trusted boolean, signed_in_at timestamptz, last_seen_at timestamptz, expires_at timestamptz, current boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT s.id, s.device_label, s.trusted, s.signed_in_at, s.last_seen_at, s.expires_at, s.id = p_session
      FROM app_auth_live_sessions(p_session) s
     ORDER BY s.last_seen_at DESC, s.id DESC
  $$;

-- 7. Sign out one of your own sessions; another person's is never touched. True when one ended.
CREATE FUNCTION app_auth_session_revoke_own(p_session uuid, p_target uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_auth_live_sessions(p_session) s WHERE s.id = p_target) THEN RETURN false; END IF;
  PERFORM app_auth_session_revoke(p_target);
  RETURN true;
END
$$;

-- 8. Sign out everywhere else: every other live session of the same person. Returns how many.
CREATE FUNCTION app_auth_session_revoke_others(p_session uuid) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_count integer;
BEGIN
  SELECT s.user_id INTO v_user FROM auth_sessions s WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now();
  IF v_user IS NULL THEN RETURN 0; END IF;
  UPDATE auth_sessions SET revoked_at = now()
   WHERE user_id = v_user AND id <> p_session AND revoked_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM app_auth_audit(v_user, 'session.revoked_others', 'SUCCEEDED', NULL);
  RETURN v_count;
END
$$;

-- 9. Moving into an organization keeps the sign-in time, trust and device, and the target
--    organization's cap clamps a trusted session's expiry.
CREATE OR REPLACE FUNCTION app_auth_session_rescope(p_session uuid, p_organization uuid)
  RETURNS TABLE (session_id uuid, expires_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_old auth_sessions%ROWTYPE;
  v_session uuid := uuidv7();
  v_expires timestamptz;
BEGIN
  SELECT * INTO v_old FROM auth_sessions s
   WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now()
   FOR UPDATE;
  IF NOT FOUND OR NOT (
    EXISTS (SELECT 1 FROM app_email_code_organizations(v_old.user_id) AS o WHERE o = p_organization)
    OR EXISTS (
      SELECT 1 FROM deal_memberships m JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = v_old.user_id AND m.organization_id = p_organization AND m.status = 'ACTIVE' AND o.status = 'ACTIVE'
    )
  ) THEN
    RETURN;
  END IF;
  -- The cap is never under 8 hours, so an untrusted session's expiry is unchanged.
  v_expires := least(v_old.expires_at, v_old.signed_in_at + app_auth_trust_cap(p_organization));
  IF v_expires <= now() THEN RETURN; END IF;
  UPDATE auth_sessions SET revoked_at = now() WHERE id = v_old.id;
  INSERT INTO auth_sessions (id, user_id, organization_id, expires_at, signed_in_at, trusted, last_seen_at, device_label)
  VALUES (v_session, v_old.user_id, p_organization, v_expires, v_old.signed_in_at, v_old.trusted, now(), v_old.device_label);
  RETURN QUERY SELECT v_session, v_expires;
END
$$;

-- 10. The real sign-in time, now that session lengths differ.
CREATE OR REPLACE FUNCTION app_passkey_account(p_session uuid)
  RETURNS TABLE (user_id uuid, email text, display_name text, signed_in_at timestamptz, offer_dismissed boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT u.id, u.email, u.display_name, s.signed_in_at, u.passkey_offer_dismissed_at IS NOT NULL
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = p_session AND s.revoked_at IS NULL AND s.expires_at > now()
  $$;

ALTER FUNCTION app_auth_trust_cap(uuid) OWNER TO pactlab_auth;
ALTER FUNCTION app_auth_session_trust(uuid, integer, text) OWNER TO pactlab_auth;
ALTER FUNCTION app_auth_session_check(uuid, text, uuid) OWNER TO pactlab_auth;
ALTER FUNCTION app_auth_live_sessions(uuid) OWNER TO pactlab_auth;
ALTER FUNCTION app_auth_sessions_list(uuid) OWNER TO pactlab_auth;
ALTER FUNCTION app_auth_session_revoke_own(uuid, uuid) OWNER TO pactlab_auth;
ALTER FUNCTION app_auth_session_revoke_others(uuid) OWNER TO pactlab_auth;

REVOKE ALL ON FUNCTION
  app_auth_trust_cap(uuid),
  app_auth_session_trust(uuid, integer, text),
  app_auth_session_check(uuid, text, uuid),
  app_auth_live_sessions(uuid),
  app_auth_sessions_list(uuid),
  app_auth_session_revoke_own(uuid, uuid),
  app_auth_session_revoke_others(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app_auth_session_trust(uuid, integer, text),
  app_auth_session_check(uuid, text, uuid),
  app_auth_sessions_list(uuid),
  app_auth_session_revoke_own(uuid, uuid),
  app_auth_session_revoke_others(uuid)
TO pactlab_app;
