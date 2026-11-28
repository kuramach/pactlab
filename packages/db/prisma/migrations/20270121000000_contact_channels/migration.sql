-- Contact details in the profile (T-180, ADR 0064): a verified email for everyone, and Telegram and
-- WhatsApp as message channels. Contact details are personal data:
--   * a person reads only their own (RLS on user, and on organization for channels);
--   * an organization admin sees members' channels masked, through a function that audits the read;
--   * every write goes through SECURITY DEFINER functions owned by `pactlab_auth`, which act on the
--     signed-in person (`app_current_user_id()`), never on a user id the caller passes;
--   * a channel exists only once verified (verified_at NOT NULL), so an unverified channel is never used.
-- Expand-only: four new tables and new functions; `app_notification_pending_page` keeps its signature
-- and now returns the verified contact email before the sign-in address.
-- Rollback: drop the functions below, then contact_channel_deliveries, user_contact_channels,
-- contact_verifications and user_contact_emails, and restore app_notification_pending_page from
-- 20270108000000_pact_notifications.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- The address Pactlab writes to. One per person; only ever a verified one.
CREATE TABLE "user_contact_emails" (
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_contact_emails_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_contact_emails_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "user_contact_emails_normalized" CHECK ("email" = lower(btrim("email")) AND "email" LIKE '%_@_%' AND length("email") <= 254),
    CONSTRAINT "user_contact_emails_source_check" CHECK ("source" IN ('AUTH0_CLAIM', 'CODE'))
);

-- One-time codes (email, WhatsApp) and Telegram link tokens. Only a hash is stored.
CREATE TABLE "contact_verifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT,
    "secret_hash" CHAR(64) NOT NULL,
    "consent_text" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    CONSTRAINT "contact_verifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contact_verifications_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contact_verifications_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contact_verifications_kind_check" CHECK ("kind" IN ('EMAIL', 'TELEGRAM', 'WHATSAPP')),
    CONSTRAINT "contact_verifications_target_check" CHECK (
      ("kind" = 'EMAIL' AND "target" = lower(btrim("target")) AND "target" LIKE '%_@_%')
      OR ("kind" = 'TELEGRAM' AND "target" IS NULL)
      OR ("kind" = 'WHATSAPP' AND "target" ~ '^\+[1-9][0-9]{6,14}$' AND "consent_text" IS NOT NULL)),
    CONSTRAINT "contact_verifications_attempts" CHECK ("attempts" BETWEEN 0 AND 5)
);
CREATE INDEX "contact_verifications_user_kind_idx" ON "contact_verifications"("user_id", "kind", "created_at");
CREATE INDEX "contact_verifications_secret_idx" ON "contact_verifications"("secret_hash");

-- Verified message channels. A row exists only once the channel is verified.
CREATE TABLE "user_contact_channels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "consent_text" TEXT,
    "consented_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_contact_channels_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_contact_channels_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "user_contact_channels_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "user_contact_channels_kind_check" CHECK ("kind" IN ('TELEGRAM', 'WHATSAPP')),
    CONSTRAINT "user_contact_channels_handle_check" CHECK (
      ("kind" = 'TELEGRAM' AND "handle" ~ '^[0-9]{1,20}$')
      OR ("kind" = 'WHATSAPP' AND "handle" ~ '^\+[1-9][0-9]{6,14}$')),
    -- WhatsApp is opted into explicitly: the text shown and the time are kept.
    CONSTRAINT "user_contact_channels_consent_check" CHECK ("kind" <> 'WHATSAPP' OR ("consent_text" IS NOT NULL AND "consented_at" IS NOT NULL)),
    CONSTRAINT "user_contact_channels_revoked_check" CHECK (("revoked_at" IS NULL) = ("revoked_reason" IS NULL)),
    CONSTRAINT "user_contact_channels_reason_check" CHECK ("revoked_reason" IS NULL OR "revoked_reason" IN ('USER', 'BLOCKED', 'STOP', 'REPLACED'))
);
CREATE UNIQUE INDEX "user_contact_channels_live_kind" ON "user_contact_channels"("user_id", "kind") WHERE "revoked_at" IS NULL;
CREATE UNIQUE INDEX "user_contact_channels_live_handle" ON "user_contact_channels"("kind", "handle") WHERE "revoked_at" IS NULL;
CREATE INDEX "user_contact_channels_org_idx" ON "user_contact_channels"("organization_id", "user_id");

-- Every message sent on a channel, claimed before it is sent (at most once per notification and channel).
CREATE TABLE "contact_channel_deliveries" (
    "id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "notification_id" UUID,
    "purpose" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'CLAIMED',
    "error_class" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    CONSTRAINT "contact_channel_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contact_channel_deliveries_channel_fkey" FOREIGN KEY ("channel_id") REFERENCES "user_contact_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contact_channel_deliveries_notification_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contact_channel_deliveries_purpose_check" CHECK ("purpose" IN ('NOTIFICATION', 'TEST')),
    CONSTRAINT "contact_channel_deliveries_notification_check" CHECK (("purpose" = 'NOTIFICATION') = ("notification_id" IS NOT NULL)),
    CONSTRAINT "contact_channel_deliveries_outcome_check" CHECK ("outcome" IN ('CLAIMED', 'SENT', 'FAILED')),
    CONSTRAINT "contact_channel_deliveries_error_check" CHECK ("error_class" IS NULL OR "error_class" ~ '^[A-Za-z0-9_.-]{1,64}$')
);
CREATE UNIQUE INDEX "contact_channel_deliveries_once" ON "contact_channel_deliveries"("channel_id", "notification_id") WHERE "notification_id" IS NOT NULL;
CREATE INDEX "contact_channel_deliveries_channel_idx" ON "contact_channel_deliveries"("channel_id", "created_at");

-- ---------------------------------------------------------------------------
-- Row-level security. The runtime role reads only its own rows; it never writes these tables directly.
-- ---------------------------------------------------------------------------
ALTER TABLE user_contact_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_contact_emails FORCE ROW LEVEL SECURITY;
ALTER TABLE contact_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_verifications FORCE ROW LEVEL SECURITY;
ALTER TABLE user_contact_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_contact_channels FORCE ROW LEVEL SECURITY;
ALTER TABLE contact_channel_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_channel_deliveries FORCE ROW LEVEL SECURITY;

GRANT SELECT ON user_contact_emails, user_contact_channels TO pactlab_app;
CREATE POLICY user_contact_emails_own ON user_contact_emails FOR SELECT TO pactlab_app
  USING (user_id = app_current_user_id());
-- By user and organization: a person's own channels, linked in the organization they are signed in to.
CREATE POLICY user_contact_channels_own ON user_contact_channels FOR SELECT TO pactlab_app
  USING (user_id = app_current_user_id() AND organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE ON user_contact_emails, contact_verifications, user_contact_channels, contact_channel_deliveries TO pactlab_auth;
GRANT SELECT ("role") ON organization_memberships TO pactlab_auth;
GRANT SELECT ("id", "organization_id", "user_id", "email_status") ON notifications TO pactlab_auth;
CREATE POLICY user_contact_emails_auth ON user_contact_emails FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY contact_verifications_auth ON contact_verifications FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY user_contact_channels_auth ON user_contact_channels FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY contact_channel_deliveries_auth ON contact_channel_deliveries FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
-- Contact changes are audited from the functions below, at organization level, against the person.
CREATE POLICY audit_events_auth_contact ON audit_events FOR INSERT TO pactlab_auth
  WITH CHECK (deal_id IS NULL AND target_type = 'user' AND action LIKE 'contact.%');

-- ---------------------------------------------------------------------------
-- Masking, the same rule as `maskContact` in @pactlab/domain: an admin sees `+91 •••• ••12`, `k•••@example.com`.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_contact_country_code_length(p_digits text) RETURNS integer
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog
  AS $$
    SELECT CASE
      WHEN left(p_digits, 1) IN ('1', '7') THEN 1
      WHEN left(p_digits, 2) IN ('20','27','30','31','32','33','34','36','39','40','41','43','44','45','46','47','48','49',
                                 '51','52','53','54','55','56','57','58','60','61','62','63','64','65','66',
                                 '81','82','84','86','90','91','92','93','94','95','98') THEN 2
      ELSE 3 END
  $$;

CREATE FUNCTION app_contact_mask(p_kind text, p_value text) RETURNS text
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
  ELSE
    -- A Telegram chat id is not a contact detail anyone can use, but it is still never shown.
    RETURN 'Telegram ••' || right(p_value, 2);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Functions. Owned by pactlab_auth; the runtime role may only execute them.
-- ---------------------------------------------------------------------------

-- One audit row, in the given organization, against the person.
CREATE FUNCTION app_contact_audit(p_organization uuid, p_user uuid, p_action text, p_outcome text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
    VALUES (uuidv7(), p_organization, NULL, p_user, p_action, 'user', p_user::text, p_outcome)
  $$;

-- The signed-in person, as an active member or guest of the organization they are signed in to.
CREATE FUNCTION app_contact_caller() RETURNS TABLE (user_id uuid, organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT u.id, app_current_organization_id() FROM users u
     WHERE u.id = app_current_user_id() AND app_current_organization_id() IS NOT NULL
  $$;

-- Auth0 / SSO sign-in: store the identity provider's verified email (the API checks email_verified first),
-- only when the person has no address on file yet, so a confirmed change is never overwritten.
CREATE FUNCTION app_contact_email_from_claim(p_email text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_org uuid;
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_contact_caller() c;
  IF v_user IS NULL OR p_email IS NULL OR lower(btrim(p_email)) NOT LIKE '%_@_%' THEN
    RETURN false;
  END IF;
  INSERT INTO user_contact_emails (user_id, email, source, verified_at)
  VALUES (v_user, lower(btrim(p_email)), 'AUTH0_CLAIM', now())
  ON CONFLICT (user_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM app_contact_audit(v_org, v_user, 'contact.email_verified', 'SUCCEEDED');
  RETURN true;
END
$$;

-- Start a verification: an email or WhatsApp code, or a Telegram link token. Only the newest of a kind
-- is valid; at most 5 per kind per person per 15 minutes. Returns the id, or null when refused.
CREATE FUNCTION app_contact_verification_begin(p_kind text, p_target text, p_secret_hash text, p_minutes integer, p_consent_text text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_org uuid;
  v_id uuid := uuidv7();
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_contact_caller() c;
  IF v_user IS NULL OR p_minutes NOT BETWEEN 1 AND 15 THEN
    RETURN NULL;
  END IF;
  IF (SELECT count(*) FROM contact_verifications v
       WHERE v.user_id = v_user AND v.kind = p_kind AND v.created_at > now() - interval '15 minutes') >= 5 THEN
    PERFORM app_contact_audit(v_org, v_user, 'contact.verification_requested', 'DENIED');
    RETURN NULL;
  END IF;
  UPDATE contact_verifications SET expires_at = now()
   WHERE user_id = v_user AND kind = p_kind AND consumed_at IS NULL AND expires_at > now();
  INSERT INTO contact_verifications (id, organization_id, user_id, kind, target, secret_hash, consent_text, expires_at)
  VALUES (v_id, v_org, v_user, p_kind,
          CASE WHEN p_kind = 'EMAIL' THEN lower(btrim(p_target)) WHEN p_kind = 'WHATSAPP' THEN p_target END,
          p_secret_hash, CASE WHEN p_kind = 'WHATSAPP' THEN p_consent_text END,
          now() + make_interval(mins => p_minutes));
  PERFORM app_contact_audit(v_org, v_user, 'contact.verification_requested', 'SUCCEEDED');
  RETURN v_id;
END
$$;

-- The person's newest open code of a kind, checked against the hash; 5 attempts. The consumed row, or nothing.
CREATE FUNCTION app_contact_code_take(p_kind text, p_secret_hash text) RETURNS contact_verifications
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_org uuid;
  v_row contact_verifications%ROWTYPE;
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_contact_caller() c;
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_row FROM contact_verifications v
   WHERE v.user_id = v_user AND v.kind = p_kind AND v.consumed_at IS NULL AND v.expires_at > now() AND v.attempts < 5
   ORDER BY v.created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM app_contact_audit(v_org, v_user, 'contact.verification_failed', 'DENIED');
    RETURN NULL;
  END IF;
  IF v_row.secret_hash <> p_secret_hash THEN
    UPDATE contact_verifications SET attempts = attempts + 1 WHERE id = v_row.id;
    PERFORM app_contact_audit(v_org, v_user, 'contact.verification_failed', 'DENIED');
    RETURN NULL;
  END IF;
  UPDATE contact_verifications SET consumed_at = now() WHERE id = v_row.id;
  RETURN v_row;
END
$$;

-- Confirm an email code: the address becomes the person's. Returns the previous address (to notify) and the new one.
CREATE FUNCTION app_contact_email_confirm(p_secret_hash text) RETURNS TABLE (previous_email text, email text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_row contact_verifications%ROWTYPE;
  v_previous text;
BEGIN
  v_row := app_contact_code_take('EMAIL', p_secret_hash);
  IF v_row.id IS NULL THEN
    RETURN;
  END IF;
  SELECT coalesce(e.email, u.email) INTO v_previous
    FROM users u LEFT JOIN user_contact_emails e ON e.user_id = u.id WHERE u.id = v_row.user_id;
  INSERT INTO user_contact_emails (user_id, email, source, verified_at, updated_at)
  VALUES (v_row.user_id, v_row.target, 'CODE', now(), now())
  ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, source = 'CODE', verified_at = now(), updated_at = now();
  PERFORM app_contact_audit(v_row.organization_id, v_row.user_id,
    CASE WHEN v_previous IS NULL THEN 'contact.email_verified' ELSE 'contact.email_changed' END, 'SUCCEEDED');
  RETURN QUERY SELECT nullif(v_previous, v_row.target), v_row.target;
END
$$;

-- Confirm a WhatsApp code: the number becomes a verified channel, with the consent shown and its time.
CREATE FUNCTION app_contact_whatsapp_confirm(p_secret_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_row contact_verifications%ROWTYPE;
  v_id uuid := uuidv7();
BEGIN
  v_row := app_contact_code_take('WHATSAPP', p_secret_hash);
  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;
  -- The number moves to this person: whoever had it before (or this person's old number) is revoked.
  UPDATE user_contact_channels SET revoked_at = now(), revoked_reason = 'REPLACED'
   WHERE revoked_at IS NULL AND kind = 'WHATSAPP' AND (user_id = v_row.user_id OR handle = v_row.target);
  INSERT INTO user_contact_channels (id, organization_id, user_id, kind, handle, verified_at, consent_text, consented_at)
  VALUES (v_id, v_row.organization_id, v_row.user_id, 'WHATSAPP', v_row.target, now(), v_row.consent_text, v_row.created_at);
  PERFORM app_contact_audit(v_row.organization_id, v_row.user_id, 'contact.whatsapp_connected', 'SUCCEEDED');
  RETURN v_id;
END
$$;

-- Telegram: the bot received `/start <token>` from a chat (the webhook is verified by its secret header).
-- Single use, within its 10 minutes. Returns the channel id, or null.
CREATE FUNCTION app_contact_telegram_link(p_secret_hash text, p_chat_id text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_row contact_verifications%ROWTYPE;
  v_id uuid := uuidv7();
BEGIN
  IF p_chat_id !~ '^[0-9]{1,20}$' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_row FROM contact_verifications v
   WHERE v.secret_hash = p_secret_hash AND v.kind = 'TELEGRAM' AND v.consumed_at IS NULL AND v.expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE contact_verifications SET consumed_at = now() WHERE id = v_row.id;
  UPDATE user_contact_channels SET revoked_at = now(), revoked_reason = 'REPLACED'
   WHERE revoked_at IS NULL AND kind = 'TELEGRAM' AND (user_id = v_row.user_id OR handle = p_chat_id);
  INSERT INTO user_contact_channels (id, organization_id, user_id, kind, handle, verified_at)
  VALUES (v_id, v_row.organization_id, v_row.user_id, 'TELEGRAM', p_chat_id, now());
  PERFORM app_contact_audit(v_row.organization_id, v_row.user_id, 'contact.telegram_connected', 'SUCCEEDED');
  RETURN v_id;
END
$$;

-- The person disconnects one of their own channels. Returns the kind and handle (to say goodbye), or nothing.
CREATE FUNCTION app_contact_channel_revoke(p_channel uuid) RETURNS TABLE (kind text, handle text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_org uuid;
  v_kind text;
  v_handle text;
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_contact_caller() c;
  UPDATE user_contact_channels SET revoked_at = now(), revoked_reason = 'USER'
   WHERE id = p_channel AND user_id = v_user AND organization_id = v_org AND revoked_at IS NULL
   RETURNING user_contact_channels.kind, user_contact_channels.handle INTO v_kind, v_handle;
  IF v_kind IS NULL THEN
    RETURN;
  END IF;
  PERFORM app_contact_audit(v_org, v_user, 'contact.' || lower(v_kind) || '_disconnected', 'SUCCEEDED');
  RETURN QUERY SELECT v_kind, v_handle;
END
$$;

-- From a verified provider webhook: the person blocked the bot, sent /stop, or replied STOP on WhatsApp.
-- Stops every message on that channel at once. How many channels ended.
CREATE FUNCTION app_contact_channel_stop(p_kind text, p_handle text, p_reason text) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  IF p_reason NOT IN ('BLOCKED', 'STOP') THEN
    RETURN 0;
  END IF;
  FOR v_row IN
    UPDATE user_contact_channels SET revoked_at = now(), revoked_reason = p_reason
     WHERE kind = p_kind AND handle = p_handle AND revoked_at IS NULL
     RETURNING organization_id, user_id
  LOOP
    PERFORM app_contact_audit(v_row.organization_id, v_row.user_id, 'contact.' || lower(p_kind) || '_stopped', 'SUCCEEDED');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END
$$;

-- An organization owner or admin: the members' contact details, masked. Every call is audited.
CREATE FUNCTION app_contact_admin_list(p_after uuid, p_limit integer)
  RETURNS TABLE (user_id uuid, display_name text, email_masked text, email_verified boolean,
                 telegram_masked text, whatsapp_masked text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_org uuid;
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_contact_caller() c;
  IF v_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM organization_memberships m
     WHERE m.organization_id = v_org AND m.user_id = v_user AND m.status = 'ACTIVE' AND m.role IN ('ORG_OWNER', 'ORG_ADMIN')) THEN
    IF v_user IS NOT NULL AND v_org IS NOT NULL THEN
      PERFORM app_contact_audit(v_org, v_user, 'contact.admin_viewed', 'DENIED');
    END IF;
    RETURN;
  END IF;
  PERFORM app_contact_audit(v_org, v_user, 'contact.admin_viewed', 'SUCCEEDED');
  RETURN QUERY
    SELECT u.id, u.display_name,
           app_contact_mask('EMAIL', coalesce(e.email, u.email)),
           (e.email IS NOT NULL OR u.email IS NOT NULL),
           (SELECT app_contact_mask('TELEGRAM', ch.handle) FROM user_contact_channels ch
             WHERE ch.user_id = u.id AND ch.organization_id = v_org AND ch.kind = 'TELEGRAM' AND ch.revoked_at IS NULL),
           (SELECT app_contact_mask('WHATSAPP', ch.handle) FROM user_contact_channels ch
             WHERE ch.user_id = u.id AND ch.organization_id = v_org AND ch.kind = 'WHATSAPP' AND ch.revoked_at IS NULL)
      FROM organization_memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN user_contact_emails e ON e.user_id = u.id
     WHERE m.organization_id = v_org AND m.status = 'ACTIVE' AND (p_after IS NULL OR u.id > p_after)
     ORDER BY u.id
     LIMIT least(greatest(p_limit, 1), 101);
END
$$;

-- The dispatcher: the live, verified channels of the people it is about to notify.
CREATE FUNCTION app_contact_dispatch_channels(p_users uuid[])
  RETURNS TABLE (channel_id uuid, user_id uuid, kind text, handle text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT ch.id, ch.user_id, ch.kind, ch.handle FROM user_contact_channels ch
     WHERE ch.user_id = ANY (p_users) AND ch.revoked_at IS NULL
     ORDER BY ch.user_id, ch.kind
  $$;

-- Claim one message on one channel before it is sent: a notification is sent at most once per channel.
-- A test message is the person's own, at most 3 per channel per hour. The delivery id, or null.
CREATE FUNCTION app_contact_delivery_claim(p_channel uuid, p_notification uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_id uuid := uuidv7();
  v_user uuid;
BEGIN
  IF p_notification IS NULL THEN
    SELECT c.user_id INTO v_user FROM app_contact_caller() c;
    IF NOT EXISTS (SELECT 1 FROM user_contact_channels ch
                    WHERE ch.id = p_channel AND ch.user_id = v_user AND ch.organization_id = app_current_organization_id() AND ch.revoked_at IS NULL)
       OR (SELECT count(*) FROM contact_channel_deliveries d
            WHERE d.channel_id = p_channel AND d.purpose = 'TEST' AND d.created_at > now() - interval '1 hour') >= 3 THEN
      RETURN NULL;
    END IF;
    INSERT INTO contact_channel_deliveries (id, channel_id, notification_id, purpose) VALUES (v_id, p_channel, NULL, 'TEST');
    RETURN v_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_contact_channels ch JOIN notifications n ON n.user_id = ch.user_id
                  WHERE ch.id = p_channel AND n.id = p_notification AND ch.revoked_at IS NULL) THEN
    RETURN NULL;
  END IF;
  INSERT INTO contact_channel_deliveries (id, channel_id, notification_id, purpose)
  VALUES (v_id, p_channel, p_notification, 'NOTIFICATION')
  ON CONFLICT (channel_id, notification_id) WHERE notification_id IS NOT NULL DO NOTHING;
  RETURN CASE WHEN FOUND THEN v_id END;
END
$$;

CREATE FUNCTION app_contact_delivery_finish(p_delivery uuid, p_outcome text, p_error_class text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  UPDATE contact_channel_deliveries SET outcome = p_outcome, error_class = p_error_class, finished_at = now()
   WHERE id = p_delivery AND outcome = 'CLAIMED' AND p_outcome IN ('SENT', 'FAILED');
  RETURN FOUND;
END
$$;

-- The verified contact email first, then the sign-in address (unchanged signature, ADR 0046).
CREATE OR REPLACE FUNCTION app_notification_pending_page(p_after uuid, p_limit integer)
  RETURNS TABLE (notification_id uuid, user_id uuid, organization_id uuid, deal_id uuid, deal_name text, type text,
                 urgency text, link_path text, created_at timestamptz, email text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  SELECT n.id, n.user_id, n.organization_id, n.deal_id, d.name, e.type, n.urgency, e.link_path, n.created_at, coalesce(ce.email, u.email)
    FROM notifications n
    JOIN notification_events e ON e.id = n.event_id
    JOIN deals d ON d.organization_id = n.organization_id AND d.id = n.deal_id
    JOIN users u ON u.id = n.user_id
    LEFT JOIN user_contact_emails ce ON ce.user_id = n.user_id
   WHERE n.email_status = 'PENDING' AND (p_after IS NULL OR n.id > p_after)
   ORDER BY n.id
   LIMIT least(greatest(p_limit, 1), 500)
$$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_contact_audit(uuid, uuid, text, text)',
    'app_contact_caller()',
    'app_contact_email_from_claim(text)',
    'app_contact_verification_begin(text, text, text, integer, text)',
    'app_contact_code_take(text, text)',
    'app_contact_email_confirm(text)',
    'app_contact_whatsapp_confirm(text)',
    'app_contact_telegram_link(text, text)',
    'app_contact_channel_revoke(uuid)',
    'app_contact_channel_stop(text, text, text)',
    'app_contact_admin_list(uuid, integer)',
    'app_contact_dispatch_channels(uuid[])',
    'app_contact_delivery_claim(uuid, uuid)',
    'app_contact_delivery_finish(uuid, text, text)',
    'app_notification_pending_page(uuid, integer)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_auth', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'app_contact_email_from_claim(text)',
    'app_contact_verification_begin(text, text, text, integer, text)',
    'app_contact_email_confirm(text)',
    'app_contact_whatsapp_confirm(text)',
    'app_contact_telegram_link(text, text)',
    'app_contact_channel_revoke(uuid)',
    'app_contact_channel_stop(text, text, text)',
    'app_contact_admin_list(uuid, integer)',
    'app_contact_dispatch_channels(uuid[])',
    'app_contact_delivery_claim(uuid, uuid)',
    'app_contact_delivery_finish(uuid, text, text)',
    'app_notification_pending_page(uuid, integer)'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION app_contact_mask(text, text), app_contact_country_code_length(text) TO pactlab_app, pactlab_auth;
