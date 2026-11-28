-- Urgent pact alerts (T-146): web push on a person's devices, per-channel choices, a per-person daily
-- cap across every channel and one alert per pact per 15 minutes, later events folded into the next.
--   * Only "act now" items are alerted; the words are the shared, content-free template.
--   * A push subscription is per device, the person's own (RLS by user and organization); writes go
--     through SECURITY DEFINER functions acting on the signed-in person; the dispatcher reads only
--     live subscriptions; one the push service says is gone (404/410) is ended at once.
--   * The cap and the fold are decided under a per-person lock, so two API tasks never both alert.
-- Expand-only: four new tables and new functions; nothing existing changes.
-- Rollback: drop the functions below, then push_deliveries, channel_alert_items, channel_alerts,
-- push_subscriptions and notification_channel_preferences.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A person's channel choices: every channel is on unless turned off here (linking one is the opt-in).
CREATE TABLE "notification_channel_preferences" (
    "user_id" UUID NOT NULL,
    "channels_off" TEXT[] NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_channel_preferences_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "notification_channel_preferences_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "notification_channel_preferences_channels_check" CHECK ("channels_off" <@ ARRAY['WEB_PUSH', 'TELEGRAM', 'SLACK', 'TEAMS', 'WHATSAPP', 'LINE']::text[])
);

-- One browser on one device, subscribed with the Push API (VAPID). The endpoint is a capability URL
-- and the keys encrypt to it: personal data, never logged.
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    -- What the person sees in their list, e.g. "Safari on iPhone"; never the raw user agent.
    "device_label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sent_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,
    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "push_subscriptions_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "push_subscriptions_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "push_subscriptions_endpoint_check" CHECK ("endpoint" ~ '^https://[^\s/]+/\S*$' AND length("endpoint") <= 2048),
    -- base64url: a P-256 public key in uncompressed form (65 bytes) and a 16-byte auth secret.
    CONSTRAINT "push_subscriptions_p256dh_check" CHECK ("p256dh" ~ '^[A-Za-z0-9_-]{86,88}={0,2}$'),
    CONSTRAINT "push_subscriptions_auth_check" CHECK ("auth" ~ '^[A-Za-z0-9_-]{21,24}={0,2}$'),
    CONSTRAINT "push_subscriptions_label_check" CHECK (length("device_label") BETWEEN 1 AND 80),
    CONSTRAINT "push_subscriptions_revoked_check" CHECK (("revoked_at" IS NULL) = ("revoked_reason" IS NULL)),
    CONSTRAINT "push_subscriptions_reason_check" CHECK ("revoked_reason" IS NULL OR "revoked_reason" IN ('USER', 'EXPIRED', 'REPLACED'))
);
CREATE UNIQUE INDEX "push_subscriptions_live_endpoint" ON "push_subscriptions"("endpoint") WHERE "revoked_at" IS NULL;
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions"("user_id", "organization_id");

-- One alert per person per pact moment: it reaches each channel the person chose, once.
CREATE TABLE "channel_alerts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "channel_alerts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "channel_alerts_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "channel_alerts_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "channel_alerts_user_idx" ON "channel_alerts"("user_id", "created_at");

-- What became of each "act now" item on the channels: in an alert, held back by the daily cap, or
-- skipped (in-app only on that pact, or no channel chosen). An item has at most one row.
CREATE TABLE "channel_alert_items" (
    "notification_id" UUID NOT NULL,
    "alert_id" UUID,
    "outcome" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_alert_items_pkey" PRIMARY KEY ("notification_id"),
    CONSTRAINT "channel_alert_items_notification_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "channel_alert_items_alert_fkey" FOREIGN KEY ("alert_id") REFERENCES "channel_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "channel_alert_items_outcome_check" CHECK ("outcome" IN ('ALERTED', 'CAPPED', 'SKIPPED')),
    CONSTRAINT "channel_alert_items_alert_check" CHECK (("outcome" = 'ALERTED') = ("alert_id" IS NOT NULL))
);
CREATE INDEX "channel_alert_items_alert_idx" ON "channel_alert_items"("alert_id");

-- Each web push sent, claimed before it is sent (at most once per alert and device).
CREATE TABLE "push_deliveries" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "alert_id" UUID,
    "purpose" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'CLAIMED',
    "error_class" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "push_deliveries_subscription_fkey" FOREIGN KEY ("subscription_id") REFERENCES "push_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "push_deliveries_alert_fkey" FOREIGN KEY ("alert_id") REFERENCES "channel_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "push_deliveries_purpose_check" CHECK ("purpose" IN ('ALERT', 'TEST')),
    CONSTRAINT "push_deliveries_alert_check" CHECK (("purpose" = 'ALERT') = ("alert_id" IS NOT NULL)),
    CONSTRAINT "push_deliveries_outcome_check" CHECK ("outcome" IN ('CLAIMED', 'SENT', 'FAILED', 'EXPIRED')),
    CONSTRAINT "push_deliveries_error_check" CHECK ("error_class" IS NULL OR "error_class" ~ '^[A-Za-z0-9_.-]{1,64}$')
);
CREATE UNIQUE INDEX "push_deliveries_once" ON "push_deliveries"("subscription_id", "alert_id") WHERE "alert_id" IS NOT NULL;
CREATE INDEX "push_deliveries_subscription_idx" ON "push_deliveries"("subscription_id", "created_at");

-- ---------------------------------------------------------------------------
-- Row-level security. The runtime role reads only its own rows and writes only its channel choices.
-- ---------------------------------------------------------------------------
ALTER TABLE notification_channel_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_channel_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE channel_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE channel_alert_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_alert_items FORCE ROW LEVEL SECURITY;
ALTER TABLE push_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_deliveries FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON notification_channel_preferences TO pactlab_app;
CREATE POLICY notification_channel_preferences_own_select ON notification_channel_preferences FOR SELECT TO pactlab_app
  USING (user_id = app_current_user_id());
CREATE POLICY notification_channel_preferences_own_insert ON notification_channel_preferences FOR INSERT TO pactlab_app
  WITH CHECK (user_id = app_current_user_id());
CREATE POLICY notification_channel_preferences_own_update ON notification_channel_preferences FOR UPDATE TO pactlab_app
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

GRANT SELECT ("id", "organization_id", "user_id", "device_label", "created_at", "last_sent_at", "revoked_at", "revoked_reason") ON push_subscriptions TO pactlab_app;
CREATE POLICY push_subscriptions_own ON push_subscriptions FOR SELECT TO pactlab_app
  USING (user_id = app_current_user_id() AND organization_id = app_current_organization_id());

GRANT SELECT ON notification_channel_preferences TO pactlab_auth;
CREATE POLICY notification_channel_preferences_auth ON notification_channel_preferences FOR SELECT TO pactlab_auth USING (true);
GRANT SELECT, INSERT, UPDATE ON push_subscriptions, channel_alerts, channel_alert_items, push_deliveries TO pactlab_auth;
CREATE POLICY push_subscriptions_auth ON push_subscriptions FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY channel_alerts_auth ON channel_alerts FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY channel_alert_items_auth ON channel_alert_items FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY push_deliveries_auth ON push_deliveries FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
GRANT SELECT ("id", "organization_id", "deal_id", "user_id", "urgency", "created_at") ON notifications TO pactlab_auth;

-- ---------------------------------------------------------------------------
-- The person's own devices
-- ---------------------------------------------------------------------------

-- Subscribe this browser. The same endpoint subscribed again (or by someone else on a shared browser)
-- replaces the old row. At most 10 live devices a person; the oldest is ended to make room.
CREATE FUNCTION app_push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_label text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_id uuid := uuidv7();
  v_user uuid;
  v_org uuid;
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_contact_caller() c;
  IF v_user IS NULL OR v_org IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('push-subscribe:' || v_user::text));
  UPDATE push_subscriptions SET revoked_at = now(), revoked_reason = 'REPLACED'
   WHERE endpoint = p_endpoint AND revoked_at IS NULL;
  UPDATE push_subscriptions SET revoked_at = now(), revoked_reason = 'REPLACED'
   WHERE id IN (SELECT s.id FROM push_subscriptions s WHERE s.user_id = v_user AND s.revoked_at IS NULL
                 ORDER BY s.created_at DESC OFFSET 9);
  INSERT INTO push_subscriptions (id, organization_id, user_id, endpoint, p256dh, auth, device_label)
  VALUES (v_id, v_org, v_user, p_endpoint, p_p256dh, p_auth, p_label);
  PERFORM app_contact_audit(v_org, v_user, 'contact.push_subscribed', 'SUCCEEDED');
  RETURN v_id;
END
$$;

-- The person removes one of their own devices. True when it was theirs and live.
CREATE FUNCTION app_push_unsubscribe(p_subscription uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_org uuid;
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_contact_caller() c;
  UPDATE push_subscriptions SET revoked_at = now(), revoked_reason = 'USER'
   WHERE id = p_subscription AND user_id = v_user AND organization_id = v_org AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM app_contact_audit(v_org, v_user, 'contact.push_unsubscribed', 'SUCCEEDED');
  RETURN true;
END
$$;

-- The push service said the subscription is gone (404 or 410): end it. No session: the dispatcher.
CREATE FUNCTION app_push_expire(p_subscription uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_row record;
BEGIN
  UPDATE push_subscriptions SET revoked_at = now(), revoked_reason = 'EXPIRED'
   WHERE id = p_subscription AND revoked_at IS NULL
  RETURNING organization_id, user_id INTO v_row;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM app_contact_audit(v_row.organization_id, v_row.user_id, 'contact.push_expired', 'SUCCEEDED');
  RETURN true;
END
$$;

-- The live subscriptions of the people the dispatcher is about to alert, or the caller's own one (test).
CREATE FUNCTION app_push_dispatch_targets(p_users uuid[])
  RETURNS TABLE (subscription_id uuid, user_id uuid, endpoint text, p256dh text, auth text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s
     WHERE s.user_id = ANY (p_users) AND s.revoked_at IS NULL
     ORDER BY s.user_id, s.created_at
  $$;

-- The caller's own device, for a test alert: at most 3 an hour per device. Null when refused.
CREATE FUNCTION app_push_test_claim(p_subscription uuid)
  RETURNS TABLE (delivery_id uuid, endpoint text, p256dh text, auth text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_user uuid;
  v_org uuid;
  v_id uuid := uuidv7();
BEGIN
  SELECT c.user_id, c.organization_id INTO v_user, v_org FROM app_contact_caller() c;
  IF NOT EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.id = p_subscription AND s.user_id = v_user AND s.organization_id = v_org AND s.revoked_at IS NULL)
     OR (SELECT count(*) FROM push_deliveries d WHERE d.subscription_id = p_subscription AND d.purpose = 'TEST' AND d.created_at > now() - interval '1 hour') >= 3 THEN
    RETURN;
  END IF;
  INSERT INTO push_deliveries (id, subscription_id, alert_id, purpose) VALUES (v_id, p_subscription, NULL, 'TEST');
  RETURN QUERY SELECT v_id, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s WHERE s.id = p_subscription;
END
$$;

-- Claim one alert on one device before it is sent: at most once.
CREATE FUNCTION app_push_delivery_claim(p_subscription uuid, p_alert uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_id uuid := uuidv7();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM push_subscriptions s JOIN channel_alerts a ON a.user_id = s.user_id
                  WHERE s.id = p_subscription AND a.id = p_alert AND s.revoked_at IS NULL) THEN
    RETURN NULL;
  END IF;
  INSERT INTO push_deliveries (id, subscription_id, alert_id, purpose) VALUES (v_id, p_subscription, p_alert, 'ALERT')
  ON CONFLICT (subscription_id, alert_id) WHERE alert_id IS NOT NULL DO NOTHING;
  RETURN CASE WHEN FOUND THEN v_id END;
END
$$;

CREATE FUNCTION app_push_delivery_finish(p_delivery uuid, p_outcome text, p_error_class text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  UPDATE push_deliveries SET outcome = p_outcome, error_class = p_error_class, finished_at = now()
   WHERE id = p_delivery AND outcome = 'CLAIMED' AND p_outcome IN ('SENT', 'FAILED', 'EXPIRED');
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF p_outcome = 'SENT' THEN
    UPDATE push_subscriptions SET last_sent_at = now() WHERE id = (SELECT subscription_id FROM push_deliveries WHERE id = p_delivery);
  END IF;
  RETURN true;
END
$$;

-- ---------------------------------------------------------------------------
-- The dispatcher: what may be alerted, and the cap and fold under a per-person lock
-- ---------------------------------------------------------------------------

-- "Act now" items from the last 24 hours not yet decided on the channels, for people who have a live
-- channel or device. `p_now` is the dispatcher's clock.
CREATE FUNCTION app_channel_pending(p_now timestamptz, p_after uuid, p_limit integer)
  RETURNS TABLE (notification_id uuid, user_id uuid, organization_id uuid, deal_id uuid, created_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  SELECT n.id, n.user_id, n.organization_id, n.deal_id, n.created_at
    FROM notifications n
   WHERE n.urgency = 'ACT_NOW'
     AND n.created_at > p_now - interval '24 hours'
     AND (p_after IS NULL OR n.id > p_after)
     AND NOT EXISTS (SELECT 1 FROM channel_alert_items i WHERE i.notification_id = n.id)
     AND (EXISTS (SELECT 1 FROM user_contact_channels ch WHERE ch.user_id = n.user_id AND ch.revoked_at IS NULL)
          OR EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = n.user_id AND s.revoked_at IS NULL))
   ORDER BY n.id
   LIMIT least(greatest(p_limit, 1), 500)
$$;

-- People's channel choices.
CREATE FUNCTION app_channel_preferences(p_users uuid[])
  RETURNS TABLE (user_id uuid, channels_off text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT p.user_id, p.channels_off FROM notification_channel_preferences p WHERE p.user_id = ANY (p_users)
  $$;

-- One person, one pact, the items due now. Mirrors `decideAlert` in @pactlab/domain:
--   FOLD   the pact had an alert in the last p_fold_minutes: nothing is recorded, the items wait;
--   CAPPED the person had p_cap alerts in the last 24 hours: the items are recorded as capped;
--   ALERT  a new alert holds the items. Returns the decision and the alert id (ALERT only).
CREATE FUNCTION app_channel_alert_take(p_user uuid, p_deal uuid, p_ids uuid[], p_now timestamptz, p_cap integer, p_fold_minutes integer)
  RETURNS TABLE (decision text, alert_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_ids uuid[];
  v_org uuid;
  v_alert uuid := uuidv7();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('channel-alert:' || p_user::text));
  SELECT array_agg(n.id ORDER BY n.id), min(n.organization_id::text)::uuid INTO v_ids, v_org
    FROM notifications n
   WHERE n.id = ANY (p_ids) AND n.user_id = p_user AND n.deal_id = p_deal AND n.urgency = 'ACT_NOW'
     AND NOT EXISTS (SELECT 1 FROM channel_alert_items i WHERE i.notification_id = n.id);
  IF v_ids IS NULL THEN
    RETURN QUERY SELECT 'NONE'::text, NULL::uuid;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM channel_alerts a WHERE a.user_id = p_user AND a.deal_id = p_deal
              AND a.created_at > p_now - make_interval(mins => p_fold_minutes)) THEN
    RETURN QUERY SELECT 'FOLD'::text, NULL::uuid;
    RETURN;
  END IF;
  IF (SELECT count(*) FROM channel_alerts a WHERE a.user_id = p_user AND a.created_at > p_now - interval '24 hours') >= p_cap THEN
    INSERT INTO channel_alert_items (notification_id, alert_id, outcome) SELECT unnest(v_ids), NULL, 'CAPPED';
    RETURN QUERY SELECT 'CAPPED'::text, NULL::uuid;
    RETURN;
  END IF;
  INSERT INTO channel_alerts (id, organization_id, user_id, deal_id, created_at) VALUES (v_alert, v_org, p_user, p_deal, p_now);
  INSERT INTO channel_alert_items (notification_id, alert_id, outcome) SELECT unnest(v_ids), v_alert, 'ALERTED';
  RETURN QUERY SELECT 'ALERT'::text, v_alert;
END
$$;

-- Items that never go to a channel (in-app only on that pact, or no channel chosen): settled once.
CREATE FUNCTION app_channel_alert_skip(p_ids uuid[]) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO channel_alert_items (notification_id, alert_id, outcome)
  SELECT n.id, NULL, 'SKIPPED' FROM notifications n WHERE n.id = ANY (p_ids)
  ON CONFLICT (notification_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_push_subscribe(text, text, text, text)',
    'app_push_unsubscribe(uuid)',
    'app_push_expire(uuid)',
    'app_push_dispatch_targets(uuid[])',
    'app_push_test_claim(uuid)',
    'app_push_delivery_claim(uuid, uuid)',
    'app_push_delivery_finish(uuid, text, text)',
    'app_channel_pending(timestamptz, uuid, integer)',
    'app_channel_preferences(uuid[])',
    'app_channel_alert_take(uuid, uuid, uuid[], timestamptz, integer, integer)',
    'app_channel_alert_skip(uuid[])'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_auth', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
