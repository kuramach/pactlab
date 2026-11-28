-- LINE as a message channel (T-182, ADR 0066), on the T-180 contact tables.
--   * Connect LINE signs the person in with LINE Login, which gives their LINE user ID; push messages reach only
--     friends of the Pactlab LINE Official Account, so the user ID becomes a channel only once they are a friend:
--     at once when LINE Login says so, otherwise when the account's verified `follow` webhook arrives within
--     15 minutes (a pending `contact_verifications` row, kind LINE);
--   * `unfollow` (the person blocked the account) stops the channel at once (`app_contact_channel_stop`);
--   * every push counts toward the official account's monthly allowance, kept in `line_monthly_usage` by
--     calendar month in Japan time; sends stop at the allowance, and operators see that it was reached;
--   * a LINE user ID is personal data: the runtime role reads it only on the person's own channel row (the T-180
--     policy); every write is a SECURITY DEFINER function owned by `pactlab_auth`, and every change is audited.
-- Expand-only: one new table, wider CHECKs (every existing row still passes), new functions, and
-- `app_contact_mask` replaced with the same signature (a LINE branch).
-- Rollback: revoke every LINE channel and verification row, drop the functions below, restore the CHECKs from
-- 20270122000000_chat_channels and `app_contact_mask` from 20270121000000_contact_channels, then drop
-- line_monthly_usage.

-- ---------------------------------------------------------------------------
-- Wider CHECKs
-- ---------------------------------------------------------------------------
ALTER TABLE "user_contact_channels" DROP CONSTRAINT "user_contact_channels_kind_check";
ALTER TABLE "user_contact_channels" ADD CONSTRAINT "user_contact_channels_kind_check" CHECK ("kind" IN ('TELEGRAM', 'WHATSAPP', 'SLACK', 'TEAMS', 'LINE'));
ALTER TABLE "user_contact_channels" DROP CONSTRAINT "user_contact_channels_handle_check";
-- LINE: the user ID, `U` and 32 lower-case hex digits (developers.line.biz).
ALTER TABLE "user_contact_channels" ADD CONSTRAINT "user_contact_channels_handle_check" CHECK (
  ("kind" = 'TELEGRAM' AND "handle" ~ '^[0-9]{1,20}$')
  OR ("kind" = 'WHATSAPP' AND "handle" ~ '^\+[1-9][0-9]{6,14}$')
  OR ("kind" = 'SLACK' AND "handle" ~ '^T[A-Z0-9]{1,31}:[UW][A-Z0-9]{1,31}$')
  OR ("kind" = 'TEAMS' AND "handle" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  OR ("kind" = 'LINE' AND "handle" ~ '^U[0-9a-f]{32}$'));

ALTER TABLE "contact_verifications" DROP CONSTRAINT "contact_verifications_kind_check";
ALTER TABLE "contact_verifications" ADD CONSTRAINT "contact_verifications_kind_check" CHECK ("kind" IN ('EMAIL', 'TELEGRAM', 'WHATSAPP', 'SLACK', 'TEAMS', 'LINE'));
ALTER TABLE "contact_verifications" DROP CONSTRAINT "contact_verifications_target_check";
ALTER TABLE "contact_verifications" ADD CONSTRAINT "contact_verifications_target_check" CHECK (
  ("kind" = 'EMAIL' AND "target" = lower(btrim("target")) AND "target" LIKE '%_@_%')
  OR ("kind" = 'TELEGRAM' AND "target" IS NULL)
  OR ("kind" = 'WHATSAPP' AND "target" ~ '^\+[1-9][0-9]{6,14}$' AND "consent_text" IS NOT NULL)
  OR ("kind" = 'SLACK' AND "target" ~ '^T[A-Z0-9]{1,31}:[UW][A-Z0-9]{1,31}$')
  OR ("kind" = 'TEAMS' AND "target" ~ '^[0-9a-f-]{36}:[0-9a-f-]{36}$')
  OR ("kind" = 'LINE' AND "target" ~ '^U[0-9a-f]{32}$'));

-- ---------------------------------------------------------------------------
-- The monthly allowance: pushes counted by calendar month in Japan time. Counts only, no person.
-- ---------------------------------------------------------------------------
CREATE TABLE "line_monthly_usage" (
    "month" DATE NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    -- When sends stopped this month: the allowance was used up, or LINE answered its monthly limit.
    "reached_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "line_monthly_usage_pkey" PRIMARY KEY ("month"),
    CONSTRAINT "line_monthly_usage_month_check" CHECK (extract(day FROM "month") = 1),
    CONSTRAINT "line_monthly_usage_sent_check" CHECK ("sent" >= 0)
);
ALTER TABLE line_monthly_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_monthly_usage FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON line_monthly_usage TO pactlab_auth;
GRANT SELECT ON line_monthly_usage TO pactlab_ops;
CREATE POLICY line_monthly_usage_auth ON line_monthly_usage FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY line_monthly_usage_ops ON line_monthly_usage FOR SELECT TO pactlab_ops USING (true);

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- The same rule as `maskContact` in @pactlab/domain, now with LINE: `LINE ••3f`.
CREATE OR REPLACE FUNCTION app_contact_mask(p_kind text, p_value text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_digits text;
  v_cc integer;
BEGIN
  IF p_kind = 'EMAIL' THEN
    RETURN left(p_value, 1) || '•••@' || split_part(p_value, '@', 2);
  ELSIF p_kind = 'WHATSAPP' THEN
    v_digits := substr(p_value, 2);
    v_cc := app_contact_country_code_length(v_digits);
    RETURN '+' || left(v_digits, v_cc) || ' •••• ••' || right(v_digits, 2);
  ELSIF p_kind = 'LINE' THEN
    RETURN 'LINE ••' || right(p_value, 2);
  ELSE
    -- A Telegram chat id is not a contact detail anyone can use, but it is still never shown.
    RETURN 'Telegram ••' || right(p_value, 2);
  END IF;
END
$$;

-- The calendar month in Japan time, as LINE's plans count it.
CREATE FUNCTION app_line_month() RETURNS date
  LANGUAGE sql STABLE SET search_path = pg_catalog
  AS $$ SELECT date_trunc('month', now() AT TIME ZONE 'Asia/Tokyo')::date $$;

-- LINE Login finished for the signed-in person (the API verified the ID token and asked LINE about the
-- friendship). A friend: the user ID becomes their channel now. Not yet a friend: a pending row, completed by
-- the account's `follow` webhook within 15 minutes. LINKED, PENDING, or null when refused.
CREATE FUNCTION app_contact_line_connect(p_line_user text, p_friend boolean) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_org uuid;
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_contact_caller() c;
  IF v_user IS NULL OR v_org IS NULL OR p_line_user IS NULL OR p_line_user !~ '^U[0-9a-f]{32}$' THEN
    RETURN NULL;
  END IF;
  IF (SELECT count(*) FROM contact_verifications v
       WHERE v.user_id = v_user AND v.kind = 'LINE' AND v.created_at > now() - interval '15 minutes') >= 5 THEN
    PERFORM app_contact_audit(v_org, v_user, 'contact.verification_requested', 'DENIED');
    RETURN NULL;
  END IF;
  -- Only the newest connection counts, for this person and for this LINE user.
  UPDATE contact_verifications SET expires_at = now()
   WHERE kind = 'LINE' AND consumed_at IS NULL AND expires_at > now() AND (user_id = v_user OR target = p_line_user);
  IF p_friend THEN
    INSERT INTO contact_verifications (id, organization_id, user_id, kind, target, secret_hash, expires_at, consumed_at)
    VALUES (uuidv7(), v_org, v_user, 'LINE', p_line_user, encode(sha256(convert_to(uuidv7()::text, 'UTF8')), 'hex'), now(), now());
    UPDATE user_contact_channels SET revoked_at = now(), revoked_reason = 'REPLACED'
     WHERE revoked_at IS NULL AND kind = 'LINE' AND (user_id = v_user OR handle = p_line_user);
    INSERT INTO user_contact_channels (id, organization_id, user_id, kind, handle, verified_at)
    VALUES (uuidv7(), v_org, v_user, 'LINE', p_line_user, now());
    PERFORM app_contact_audit(v_org, v_user, 'contact.line_connected', 'SUCCEEDED');
    RETURN 'LINKED';
  END IF;
  INSERT INTO contact_verifications (id, organization_id, user_id, kind, target, secret_hash, expires_at)
  VALUES (uuidv7(), v_org, v_user, 'LINE', p_line_user, encode(sha256(convert_to(uuidv7()::text, 'UTF8')), 'hex'), now() + interval '15 minutes');
  PERFORM app_contact_audit(v_org, v_user, 'contact.verification_requested', 'SUCCEEDED');
  RETURN 'PENDING';
END
$$;

-- From the verified webhook: a LINE user added the account as a friend. When they connected LINE in the last
-- 15 minutes, their user ID becomes the person's channel (once). True when a channel was made.
CREATE FUNCTION app_contact_line_follow(p_line_user text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_row contact_verifications%ROWTYPE;
BEGIN
  IF p_line_user IS NULL OR p_line_user !~ '^U[0-9a-f]{32}$' THEN
    RETURN false;
  END IF;
  SELECT * INTO v_row FROM contact_verifications v
   WHERE v.kind = 'LINE' AND v.target = p_line_user AND v.consumed_at IS NULL AND v.expires_at > now()
   ORDER BY v.created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE contact_verifications SET consumed_at = now() WHERE id = v_row.id;
  UPDATE user_contact_channels SET revoked_at = now(), revoked_reason = 'REPLACED'
   WHERE revoked_at IS NULL AND kind = 'LINE' AND (user_id = v_row.user_id OR handle = p_line_user);
  INSERT INTO user_contact_channels (id, organization_id, user_id, kind, handle, verified_at)
  VALUES (uuidv7(), v_row.organization_id, v_row.user_id, 'LINE', p_line_user, now());
  PERFORM app_contact_audit(v_row.organization_id, v_row.user_id, 'contact.line_connected', 'SUCCEEDED');
  RETURN true;
END
$$;

-- The signed-in person has connected LINE Login but not yet added the account as a friend.
CREATE FUNCTION app_contact_line_pending() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (SELECT 1 FROM contact_verifications v, app_contact_caller() c
                    WHERE v.user_id = c.user_id AND v.organization_id = c.organization_id AND v.kind = 'LINE'
                      AND v.consumed_at IS NULL AND v.expires_at > now())
  $$;

-- Take one push from this month's allowance, before it is sent. False once the allowance is used up, or LINE
-- has answered its monthly limit; the first refusal records when the allowance was reached.
CREATE FUNCTION app_line_quota_take(p_allowance integer) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_month date := app_line_month();
BEGIN
  INSERT INTO line_monthly_usage (month) VALUES (v_month) ON CONFLICT (month) DO NOTHING;
  UPDATE line_monthly_usage SET sent = sent + 1, updated_at = now()
   WHERE month = v_month AND reached_at IS NULL AND sent < greatest(p_allowance, 0);
  IF FOUND THEN
    RETURN true;
  END IF;
  UPDATE line_monthly_usage SET reached_at = coalesce(reached_at, now()), updated_at = now() WHERE month = v_month;
  RETURN false;
END
$$;

-- A push that LINE did not accept is not counted: give it back.
CREATE FUNCTION app_line_quota_release() RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    UPDATE line_monthly_usage SET sent = greatest(sent - 1, 0), updated_at = now() WHERE month = app_line_month()
  $$;

-- LINE answered "You have reached your monthly limit.": no more pushes this month.
CREATE FUNCTION app_line_quota_exhausted() RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    INSERT INTO line_monthly_usage (month, reached_at) VALUES (app_line_month(), now())
    ON CONFLICT (month) DO UPDATE SET reached_at = coalesce(line_monthly_usage.reached_at, now()), updated_at = now()
  $$;

-- Operators: this month's pushes and whether the allowance was reached. Counts only.
CREATE FUNCTION app_ops_line_usage(p_actor uuid) RETURNS TABLE (month date, sent integer, reached_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT app_line_month(), coalesce(u.sent, 0), u.reached_at
      FROM (SELECT 1) one LEFT JOIN line_monthly_usage u ON u.month = app_line_month();
END
$$;

-- Organization owners and admins: members' LINE channels, masked, for the people on a page of
-- `app_contact_admin_list` (which audits the read). Nothing for anyone else.
CREATE FUNCTION app_contact_admin_line(p_users uuid[]) RETURNS TABLE (user_id uuid, line_masked text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT ch.user_id, app_contact_mask('LINE', ch.handle) FROM user_contact_channels ch, app_chat_admin_caller() c
     WHERE ch.user_id = ANY (p_users) AND ch.organization_id = c.organization_id AND ch.kind = 'LINE' AND ch.revoked_at IS NULL
  $$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_contact_line_connect(text, boolean)',
    'app_contact_line_follow(text)',
    'app_contact_line_pending()',
    'app_line_quota_take(integer)',
    'app_line_quota_release()',
    'app_line_quota_exhausted()',
    'app_contact_admin_line(uuid[])'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_auth', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION app_contact_mask(text, text) TO pactlab_app, pactlab_auth;
GRANT EXECUTE ON FUNCTION app_line_month() TO pactlab_app, pactlab_auth, pactlab_ops;
ALTER FUNCTION app_ops_line_usage(uuid) OWNER TO pactlab_ops;
REVOKE ALL ON FUNCTION app_ops_line_usage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_ops_line_usage(uuid) TO pactlab_app;
