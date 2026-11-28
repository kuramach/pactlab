-- LINE for Japan (T-182, ADR 0069): LINE as a message channel on the T-180 contact tables.
--   * a person connects with LINE Login (OAuth 2.0 / OpenID Connect) to prove their LINE user id, then
--     adds the Pactlab official account as a friend; the id is stored against the person only after both.
--     Between the two steps the verification holds a keyed hash of the id, never the id itself;
--   * the `unfollow` webhook (the person blocked the account) ends the channel at once;
--   * the official account's monthly free allowance is a platform-wide cap: a claim past it is refused,
--     the month is recorded as reached (`line_allowance_months`) and operators see it; the person still
--     gets email, which never depended on LINE.
--   * a LINE user id is personal data: the runtime role reads none of these rows except its own channel;
--     SECURITY DEFINER functions owned by `pactlab_auth` act on the signed-in person or a verified webhook.
-- Expand-only: one new table, wider CHECKs (every existing row still passes), new functions.
-- Rollback: revoke every LINE channel and verification row, drop the functions below and
-- line_allowance_months, and restore the CHECKs from 20270122000000_chat_channels.

ALTER TABLE "user_contact_channels" DROP CONSTRAINT "user_contact_channels_kind_check";
ALTER TABLE "user_contact_channels" ADD CONSTRAINT "user_contact_channels_kind_check" CHECK ("kind" IN ('TELEGRAM', 'WHATSAPP', 'SLACK', 'TEAMS', 'LINE'));
ALTER TABLE "user_contact_channels" DROP CONSTRAINT "user_contact_channels_handle_check";
-- LINE: the user id for Pactlab's provider, `U` and 32 lower-case hex digits (developers.line.biz).
ALTER TABLE "user_contact_channels" ADD CONSTRAINT "user_contact_channels_handle_check" CHECK (
  ("kind" = 'TELEGRAM' AND "handle" ~ '^[0-9]{1,20}$')
  OR ("kind" = 'WHATSAPP' AND "handle" ~ '^\+[1-9][0-9]{6,14}$')
  OR ("kind" = 'SLACK' AND "handle" ~ '^T[A-Z0-9]{1,31}:[UW][A-Z0-9]{1,31}$')
  OR ("kind" = 'TEAMS' AND "handle" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  OR ("kind" = 'LINE' AND "handle" ~ '^U[0-9a-f]{32}$'));

ALTER TABLE "contact_verifications" DROP CONSTRAINT "contact_verifications_kind_check";
ALTER TABLE "contact_verifications" ADD CONSTRAINT "contact_verifications_kind_check" CHECK ("kind" IN ('EMAIL', 'TELEGRAM', 'WHATSAPP', 'SLACK', 'TEAMS', 'LINE'));
ALTER TABLE "contact_verifications" DROP CONSTRAINT "contact_verifications_target_check";
-- LINE: no target while the person is at LINE Login; then a keyed hash of their LINE user id until they add the friend.
ALTER TABLE "contact_verifications" ADD CONSTRAINT "contact_verifications_target_check" CHECK (
  ("kind" = 'EMAIL' AND "target" = lower(btrim("target")) AND "target" LIKE '%_@_%')
  OR ("kind" = 'TELEGRAM' AND "target" IS NULL)
  OR ("kind" = 'WHATSAPP' AND "target" ~ '^\+[1-9][0-9]{6,14}$' AND "consent_text" IS NOT NULL)
  OR ("kind" = 'SLACK' AND "target" ~ '^T[A-Z0-9]{1,31}:[UW][A-Z0-9]{1,31}$')
  OR ("kind" = 'TEAMS' AND "target" ~ '^[0-9a-f-]{36}:[0-9a-f-]{36}$')
  OR ("kind" = 'LINE' AND ("target" IS NULL OR "target" ~ '^[0-9a-f]{64}$')));

-- One row per calendar month (Japan time) in which the official account's allowance was reached.
CREATE TABLE "line_allowance_months" (
    "month" DATE NOT NULL,
    "allowance" INTEGER NOT NULL,
    "reached_at" TIMESTAMPTZ(3) NOT NULL,
    -- Set once when operators have been told, so they are told once a month.
    "notified_at" TIMESTAMPTZ(3),
    CONSTRAINT "line_allowance_months_pkey" PRIMARY KEY ("month"),
    CONSTRAINT "line_allowance_months_first_day" CHECK (extract(day FROM "month") = 1),
    CONSTRAINT "line_allowance_months_allowance" CHECK ("allowance" > 0)
);
ALTER TABLE line_allowance_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_allowance_months FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON line_allowance_months TO pactlab_auth;
CREATE POLICY line_allowance_months_auth ON line_allowance_months FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Functions. Owned by pactlab_auth; the runtime role may only execute them.
-- ---------------------------------------------------------------------------

-- The first day of the month a moment falls in, in Japan time (the official account is a Japanese account).
CREATE FUNCTION app_line_month(p_now timestamptz) RETURNS date
  LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog
  AS $$ SELECT date_trunc('month', p_now AT TIME ZONE 'Asia/Tokyo')::date $$;

-- Link a LINE user id to a verification's person: whoever held the id before (or this person's old LINE) is replaced.
CREATE FUNCTION app_line_link(p_verification uuid, p_line_user text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_row contact_verifications%ROWTYPE;
  v_id uuid := uuidv7();
BEGIN
  IF p_line_user !~ '^U[0-9a-f]{32}$' THEN
    RETURN NULL;
  END IF;
  UPDATE contact_verifications SET consumed_at = now(), target = NULL
   WHERE id = p_verification AND kind = 'LINE' AND consumed_at IS NULL AND expires_at > now()
   RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE user_contact_channels SET revoked_at = now(), revoked_reason = 'REPLACED'
   WHERE revoked_at IS NULL AND kind = 'LINE' AND (user_id = v_row.user_id OR handle = p_line_user);
  INSERT INTO user_contact_channels (id, organization_id, user_id, kind, handle, verified_at)
  VALUES (v_id, v_row.organization_id, v_row.user_id, 'LINE', p_line_user, now());
  PERFORM app_contact_audit(v_row.organization_id, v_row.user_id, 'contact.line_connected', 'SUCCEEDED');
  RETURN v_id;
END
$$;

-- Back from LINE Login: the signed-in person's own open LINE verification (by its state's hash).
--   friend  -> linked now; the id is stored against the person. Returns ('LINKED', channel id).
--   not yet -> the verification keeps only a keyed hash of the id, for 30 minutes, until the follow
--              webhook arrives. Returns ('AWAITING_FRIEND', null).
-- Anything else (someone else's state, expired, used) -> ('INVALID', null).
CREATE FUNCTION app_line_login_complete(p_state_hash text, p_user_hash text, p_line_user text, p_is_friend boolean)
  RETURNS TABLE (status text, channel_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_org uuid;
  v_row contact_verifications%ROWTYPE;
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_contact_caller() c;
  SELECT * INTO v_row FROM contact_verifications v
   WHERE v.secret_hash = p_state_hash AND v.kind = 'LINE' AND v.user_id = v_user AND v.organization_id = v_org
     AND v.consumed_at IS NULL AND v.target IS NULL AND v.expires_at > now()
   FOR UPDATE;
  IF v_row.id IS NULL OR p_user_hash !~ '^[0-9a-f]{64}$' THEN
    IF v_user IS NOT NULL AND v_org IS NOT NULL THEN
      PERFORM app_contact_audit(v_org, v_user, 'contact.verification_failed', 'DENIED');
    END IF;
    RETURN QUERY SELECT 'INVALID'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_is_friend THEN
    RETURN QUERY SELECT 'LINKED'::text, app_line_link(v_row.id, p_line_user);
    RETURN;
  END IF;
  UPDATE contact_verifications SET target = p_user_hash, expires_at = now() + interval '30 minutes' WHERE id = v_row.id;
  RETURN QUERY SELECT 'AWAITING_FRIEND'::text, NULL::uuid;
END
$$;

-- From the verified `follow` webhook: the friend a person was waiting to add. The channel id, or null
-- (a friend with no pending LINE Login: nothing is stored).
CREATE FUNCTION app_line_follow(p_user_hash text, p_line_user text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT v.id INTO v_id FROM contact_verifications v
   WHERE v.kind = 'LINE' AND v.target = p_user_hash AND v.consumed_at IS NULL AND v.expires_at > now()
   ORDER BY v.created_at DESC LIMIT 1;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN app_line_link(v_id, p_line_user);
END
$$;

-- The signed-in person has signed in with LINE and has yet to add the friend (the profile says so).
CREATE FUNCTION app_line_pending() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (SELECT 1 FROM app_contact_caller() c JOIN contact_verifications v ON v.user_id = c.user_id AND v.organization_id = c.organization_id
                    WHERE v.kind = 'LINE' AND v.target IS NOT NULL AND v.consumed_at IS NULL AND v.expires_at > now())
  $$;

-- LINE messages claimed or sent this month (Japan time): what counts against the official account's allowance.
CREATE FUNCTION app_line_month_used(p_now timestamptz) RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT count(*)::int FROM contact_channel_deliveries d JOIN user_contact_channels ch ON ch.id = d.channel_id
     WHERE ch.kind = 'LINE' AND d.outcome IN ('CLAIMED', 'SENT')
       AND d.created_at >= (app_line_month(p_now)::timestamp AT TIME ZONE 'Asia/Tokyo')
  $$;

-- Record the month as reached (the local count, or LINE's own "monthly limit" answer). True the first time.
CREATE FUNCTION app_line_allowance_reached(p_now timestamptz, p_allowance integer) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  INSERT INTO line_allowance_months (month, allowance, reached_at) VALUES (app_line_month(p_now), greatest(p_allowance, 1), now())
  ON CONFLICT (month) DO NOTHING;
  RETURN FOUND;
END
$$;

-- Claim one LINE message within the month's allowance, under one platform-wide lock so two API tasks
-- never both send the last one. A notification (the dispatcher) or the caller's own test (no notification).
-- Returns the delivery id, or null with `reached` true when the allowance is used up.
CREATE FUNCTION app_line_delivery_claim(p_channel uuid, p_notification uuid, p_now timestamptz, p_allowance integer)
  RETURNS TABLE (delivery_id uuid, reached boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_contact_channels ch WHERE ch.id = p_channel AND ch.kind = 'LINE' AND ch.revoked_at IS NULL) THEN
    RETURN QUERY SELECT NULL::uuid, false;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('line-allowance'));
  IF EXISTS (SELECT 1 FROM line_allowance_months m WHERE m.month = app_line_month(p_now)) OR app_line_month_used(p_now) >= p_allowance THEN
    PERFORM app_line_allowance_reached(p_now, p_allowance);
    RETURN QUERY SELECT NULL::uuid, true;
    RETURN;
  END IF;
  RETURN QUERY SELECT app_contact_delivery_claim(p_channel, p_notification), false;
END
$$;

-- Operators are told once a month: true for the first caller after the month is reached.
CREATE FUNCTION app_line_allowance_notify(p_now timestamptz) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  UPDATE line_allowance_months SET notified_at = now() WHERE month = app_line_month(p_now) AND notified_at IS NULL;
  RETURN FOUND;
END
$$;

-- The operator console: this month's LINE use against the allowance, and whether it was reached. Counts only.
CREATE FUNCTION app_ops_line_allowance(p_actor uuid, p_now timestamptz)
  RETURNS TABLE (month date, used integer, reached_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY SELECT app_line_month(p_now), app_line_month_used(p_now),
                      (SELECT m.reached_at FROM line_allowance_months m WHERE m.month = app_line_month(p_now));
END
$$;

GRANT EXECUTE ON FUNCTION app_ops_require(uuid) TO pactlab_auth;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_line_link(uuid, text)',
    'app_line_login_complete(text, text, text, boolean)',
    'app_line_follow(text, text)',
    'app_line_pending()',
    'app_line_month_used(timestamptz)',
    'app_line_allowance_reached(timestamptz, integer)',
    'app_line_delivery_claim(uuid, uuid, timestamptz, integer)',
    'app_line_allowance_notify(timestamptz)',
    'app_ops_line_allowance(uuid, timestamptz)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_auth', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'app_line_login_complete(text, text, text, boolean)',
    'app_line_follow(text, text)',
    'app_line_pending()',
    'app_line_allowance_reached(timestamptz, integer)',
    'app_line_delivery_claim(uuid, uuid, timestamptz, integer)',
    'app_line_allowance_notify(timestamptz)',
    'app_ops_line_allowance(uuid, timestamptz)'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION app_line_month(timestamptz) TO pactlab_app, pactlab_auth;
