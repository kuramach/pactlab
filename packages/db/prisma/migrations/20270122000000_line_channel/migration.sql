-- LINE for Japan (T-182, ADR 0064 addendum): LINE joins Telegram and WhatsApp as a message channel.
-- Linking takes two steps, LINE Login then adding the official account as a friend; the LINE user id is
-- stored against the person only once both are done. Until then only a keyed hash of it is kept, on a
-- 15-minute pending verification, so an abandoned link leaves no user id behind. Unfollowing (blocking)
-- the account stops the channel at once (the existing app_contact_channel_stop).
-- A LINE user id is personal data: same RLS (user and organization), same audited functions as T-180.
-- Expand-only: wider CHECKs, two new functions, a masked admin list with a LINE column beside the old one,
-- app_contact_mask learns LINE (same signature), and an operator count of this month's LINE sends.
-- Rollback: revoke and drop app_contact_line_login, app_contact_line_follow, app_contact_admin_list_v2 and
-- app_ops_line_month; revoke LINE channels (UPDATE … SET revoked_at = now(), revoked_reason = 'USER'), delete
-- LINE verifications, and restore the CHECKs and app_contact_mask from 20270121000000_contact_channels.

ALTER TABLE contact_verifications DROP CONSTRAINT "contact_verifications_kind_check";
ALTER TABLE contact_verifications ADD CONSTRAINT "contact_verifications_kind_check" CHECK ("kind" IN ('EMAIL', 'TELEGRAM', 'WHATSAPP', 'LINE'));
ALTER TABLE contact_verifications DROP CONSTRAINT "contact_verifications_target_check";
ALTER TABLE contact_verifications ADD CONSTRAINT "contact_verifications_target_check" CHECK (
  ("kind" = 'EMAIL' AND "target" = lower(btrim("target")) AND "target" LIKE '%_@_%')
  OR ("kind" = 'TELEGRAM' AND "target" IS NULL)
  OR ("kind" = 'WHATSAPP' AND "target" ~ '^\+[1-9][0-9]{6,14}$' AND "consent_text" IS NOT NULL)
  -- LINE: the login's state (target NULL), then, after LINE Login, a wait for the friend step.
  OR ("kind" = 'LINE' AND ("target" IS NULL OR "target" = 'AWAITING_FRIEND')));

ALTER TABLE user_contact_channels DROP CONSTRAINT "user_contact_channels_kind_check";
ALTER TABLE user_contact_channels ADD CONSTRAINT "user_contact_channels_kind_check" CHECK ("kind" IN ('TELEGRAM', 'WHATSAPP', 'LINE'));
ALTER TABLE user_contact_channels DROP CONSTRAINT "user_contact_channels_handle_check";
ALTER TABLE user_contact_channels ADD CONSTRAINT "user_contact_channels_handle_check" CHECK (
  ("kind" = 'TELEGRAM' AND "handle" ~ '^[0-9]{1,20}$')
  OR ("kind" = 'WHATSAPP' AND "handle" ~ '^\+[1-9][0-9]{6,14}$')
  OR ("kind" = 'LINE' AND "handle" ~ '^U[0-9a-f]{32}$'));

-- The same rule as `maskContact` in @pactlab/domain, now with LINE.
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
    RETURN 'Telegram ••' || right(p_value, 2);
  END IF;
END
$$;

-- A LINE channel for this person: whoever had the LINE user id before (or this person's old one) is replaced.
CREATE FUNCTION app_contact_line_channel(p_organization uuid, p_user uuid, p_line_user text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_id uuid := uuidv7();
BEGIN
  UPDATE user_contact_channels SET revoked_at = now(), revoked_reason = 'REPLACED'
   WHERE revoked_at IS NULL AND kind = 'LINE' AND (user_id = p_user OR handle = p_line_user);
  INSERT INTO user_contact_channels (id, organization_id, user_id, kind, handle, verified_at)
  VALUES (v_id, p_organization, p_user, 'LINE', p_line_user, now());
  PERFORM app_contact_audit(p_organization, p_user, 'contact.line_connected', 'SUCCEEDED');
  RETURN v_id;
END
$$;

-- The signed-in person came back from LINE Login (the API exchanged the code and verified the ID token).
-- Takes their own login state once. A friend already: the channel now ('CONNECTED'). Not yet: a 15-minute
-- wait for the follow event, keyed by a hash of the LINE user id, which is not stored ('AWAITING_FRIEND').
-- Null: the state is not theirs, used, or expired.
CREATE FUNCTION app_contact_line_login(p_state_hash text, p_user_hash text, p_line_user text, p_friend boolean) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_org uuid;
  v_row contact_verifications%ROWTYPE;
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_contact_caller() c;
  IF v_user IS NULL OR p_line_user !~ '^U[0-9a-f]{32}$' OR p_user_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_row FROM contact_verifications v
   WHERE v.user_id = v_user AND v.organization_id = v_org AND v.kind = 'LINE' AND v.target IS NULL
     AND v.secret_hash = p_state_hash AND v.consumed_at IS NULL AND v.expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_contact_audit(v_org, v_user, 'contact.verification_failed', 'DENIED');
    RETURN NULL;
  END IF;
  UPDATE contact_verifications SET consumed_at = now() WHERE id = v_row.id;
  IF p_friend THEN
    PERFORM app_contact_line_channel(v_org, v_user, p_line_user);
    RETURN 'CONNECTED';
  END IF;
  UPDATE contact_verifications SET expires_at = now()
   WHERE user_id = v_user AND kind = 'LINE' AND target = 'AWAITING_FRIEND' AND consumed_at IS NULL AND expires_at > now();
  INSERT INTO contact_verifications (id, organization_id, user_id, kind, target, secret_hash, expires_at)
  VALUES (uuidv7(), v_org, v_user, 'LINE', 'AWAITING_FRIEND', p_user_hash, now() + interval '15 minutes');
  PERFORM app_contact_audit(v_org, v_user, 'contact.line_awaiting_friend', 'SUCCEEDED');
  RETURN 'AWAITING_FRIEND';
END
$$;

-- From the verified LINE webhook: a follow event. Completes a wait from app_contact_line_login, once,
-- within its 15 minutes. The channel id, or null (nobody is waiting for that LINE user).
CREATE FUNCTION app_contact_line_follow(p_user_hash text, p_line_user text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_row contact_verifications%ROWTYPE;
BEGIN
  IF p_line_user !~ '^U[0-9a-f]{32}$' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_row FROM contact_verifications v
   WHERE v.secret_hash = p_user_hash AND v.kind = 'LINE' AND v.target = 'AWAITING_FRIEND'
     AND v.consumed_at IS NULL AND v.expires_at > now()
   ORDER BY v.created_at DESC LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE contact_verifications SET consumed_at = now() WHERE id = v_row.id;
  RETURN app_contact_line_channel(v_row.organization_id, v_row.user_id, p_line_user);
END
$$;

-- An organization owner or admin: members' contact details, masked, with LINE. Every call is audited.
CREATE FUNCTION app_contact_admin_list_v2(p_after uuid, p_limit integer)
  RETURNS TABLE (user_id uuid, display_name text, email_masked text, email_verified boolean,
                 telegram_masked text, whatsapp_masked text, line_masked text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_org uuid := app_current_organization_id();
BEGIN
  -- The T-180 list checks the caller and audits the read; its rows, plus each member's LINE.
  RETURN QUERY
    SELECT l.user_id, l.display_name, l.email_masked, l.email_verified, l.telegram_masked, l.whatsapp_masked,
           (SELECT app_contact_mask('LINE', ch.handle) FROM user_contact_channels ch
             WHERE ch.user_id = l.user_id AND ch.organization_id = v_org AND ch.kind = 'LINE' AND ch.revoked_at IS NULL)
      FROM app_contact_admin_list(p_after, p_limit) l;
END
$$;

-- Operators: this month's LINE messages as Pactlab counted them (UTC month): sent, and held back at the cap.
-- LINE's own count (the quota endpoint) is the authority; this shows what Pactlab did about it.
CREATE FUNCTION app_ops_line_month(p_actor uuid) RETURNS TABLE (sent bigint, held_back bigint, failed bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT count(*) FILTER (WHERE d.outcome = 'SENT'),
           count(*) FILTER (WHERE d.outcome = 'FAILED' AND d.error_class = 'LineAllowanceReached'),
           count(*) FILTER (WHERE d.outcome = 'FAILED' AND d.error_class <> 'LineAllowanceReached')
      FROM contact_channel_deliveries d
      JOIN user_contact_channels ch ON ch.id = d.channel_id
     WHERE ch.kind = 'LINE' AND d.created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
END
$$;

GRANT EXECUTE ON FUNCTION app_ops_require(uuid) TO pactlab_auth;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_contact_line_channel(uuid, uuid, text)',
    'app_contact_line_login(text, text, text, boolean)',
    'app_contact_line_follow(text, text)',
    'app_contact_admin_list_v2(uuid, integer)',
    'app_ops_line_month(uuid)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_auth', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'app_contact_line_login(text, text, text, boolean)',
    'app_contact_line_follow(text, text)',
    'app_contact_admin_list_v2(uuid, integer)',
    'app_ops_line_month(uuid)'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
