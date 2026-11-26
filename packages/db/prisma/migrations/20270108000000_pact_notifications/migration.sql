-- T-145 (ADR 0046): pact activity notifications — an in-app inbox and email, with urgency and a digest.
--
-- - notification_events: one row per meaningful change on a pact, deduplicated by a stable key, written
--   in the same transaction as the change through app_notify (never by the runtime role directly).
-- - notifications: one row per recipient. Recipients follow access: computed here, server-side, from
--   active deal memberships, the event's visibility and bid, never from client input.
-- - notification_deliveries: the send record (who, which channel, when, outcome). No message bodies.
-- - notification_preferences: a person's settings, and per-pact overrides.
--
-- Expand-only: four new tables and new functions. Rollback: drop the functions below, then the four
-- tables (notifications first); nothing else reads them.

CREATE TABLE "notification_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "link_path" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_events_type_check" CHECK ("type" IN ('SIGNATURE_REQUESTED', 'TERMS_PROPOSED', 'TERMS_COUNTERED', 'DEADLINE_NEAR', 'IC_DECIDED', 'QUESTION_ASKED', 'DOCUMENT_ADDED', 'FINDING_DRAFTED', 'FINDING_DECIDED', 'MEMBER_ADDED', 'VALUATION_SUBMITTED', 'SYNC_FINISHED', 'SYNC_FAILED')),
    CONSTRAINT "notification_events_urgency_check" CHECK ("urgency" IN ('ACT_NOW', 'FYI')),
    CONSTRAINT "notification_events_dedupe_check" CHECK (length("dedupe_key") BETWEEN 1 AND 200),
    CONSTRAINT "notification_events_link_check" CHECK ("link_path" ~ '^/deals/[0-9a-f-]{36}/[a-z-]+(/[0-9a-f-]{36})?$' AND position("deal_id"::text IN "link_path") = 8),
    CONSTRAINT "notification_events_visibility_check" CHECK ("visibility" IN ('SHARED', 'BUYER_ONLY')),
    CONSTRAINT "notification_events_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "notification_events_dedupe_key" ON "notification_events"("organization_id", "deal_id", "dedupe_key");

CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLAIMED',
    "items" INTEGER NOT NULL,
    "error_class" TEXT,
    "claimed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_deliveries_kind_check" CHECK ("kind" IN ('IMMEDIATE', 'DIGEST')),
    CONSTRAINT "notification_deliveries_status_check" CHECK ("status" IN ('CLAIMED', 'SENT', 'SUPPRESSED', 'FAILED')),
    CONSTRAINT "notification_deliveries_items_check" CHECK ("items" > 0),
    CONSTRAINT "notification_deliveries_error_check" CHECK ("error_class" IS NULL OR "error_class" ~ '^[A-Za-z0-9_.:-]{1,80}$'),
    CONSTRAINT "notification_deliveries_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "notification_deliveries_user_kind_idx" ON "notification_deliveries"("user_id", "kind", "claimed_at");

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "urgency" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "email_status" TEXT NOT NULL DEFAULT 'PENDING',
    "delivery_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_urgency_check" CHECK ("urgency" IN ('ACT_NOW', 'FYI')),
    CONSTRAINT "notifications_visibility_check" CHECK ("visibility" IN ('SHARED', 'BUYER_ONLY')),
    CONSTRAINT "notifications_email_status_check" CHECK ("email_status" IN ('PENDING', 'SENDING', 'SENT', 'IN_APP_ONLY', 'SUPPRESSED', 'NO_ADDRESS', 'FAILED')),
    CONSTRAINT "notifications_delivery_check" CHECK (("delivery_id" IS NULL) = ("email_status" IN ('PENDING', 'IN_APP_ONLY', 'NO_ADDRESS'))),
    CONSTRAINT "notifications_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "notifications_event_fkey" FOREIGN KEY ("event_id") REFERENCES "notification_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "notifications_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    -- Deferred: a claim marks the rows first, then records the delivery, in one transaction.
    CONSTRAINT "notifications_delivery_fkey" FOREIGN KEY ("delivery_id") REFERENCES "notification_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX "notifications_event_user_key" ON "notifications"("event_id", "user_id");
CREATE INDEX "notifications_inbox_idx" ON "notifications"("user_id", "organization_id", "created_at" DESC, "id" DESC);
CREATE INDEX "notifications_pending_idx" ON "notifications"("id") WHERE "email_status" = 'PENDING';
CREATE INDEX "notifications_delivery_idx" ON "notifications"("delivery_id");

CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "deal_id" UUID,
    "act_now" TEXT,
    "fyi" TEXT,
    "digest" TEXT,
    "time_zone" TEXT,
    "quiet_start" SMALLINT,
    "quiet_end" SMALLINT,
    "act_now_through_quiet" BOOLEAN,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_preferences_scope_check" CHECK (("organization_id" IS NULL) = ("deal_id" IS NULL)),
    CONSTRAINT "notification_preferences_modes_check" CHECK (("act_now" IS NULL OR "act_now" IN ('EMAIL_NOW', 'EMAIL_DIGEST', 'IN_APP')) AND ("fyi" IS NULL OR "fyi" IN ('EMAIL_NOW', 'EMAIL_DIGEST', 'IN_APP'))),
    CONSTRAINT "notification_preferences_digest_check" CHECK ("digest" IS NULL OR "digest" IN ('HOURLY', 'DAILY')),
    CONSTRAINT "notification_preferences_zone_check" CHECK ("time_zone" IS NULL OR "time_zone" ~ '^[A-Za-z][A-Za-z0-9_+/-]{0,63}$'),
    CONSTRAINT "notification_preferences_quiet_check" CHECK (("quiet_start" IS NULL) = ("quiet_end" IS NULL) AND ("quiet_start" IS NULL OR ("quiet_start" BETWEEN 0 AND 1439 AND "quiet_end" BETWEEN 0 AND 1439))),
    -- A person's row is complete; a pact's override carries only modes (time zone, digest and quiet hours are the person's).
    CONSTRAINT "notification_preferences_person_check" CHECK ("deal_id" IS NOT NULL OR ("act_now" IS NOT NULL AND "fyi" IS NOT NULL AND "digest" IS NOT NULL AND "time_zone" IS NOT NULL AND "act_now_through_quiet" IS NOT NULL)),
    CONSTRAINT "notification_preferences_pact_check" CHECK ("deal_id" IS NULL OR ("digest" IS NULL AND "time_zone" IS NULL AND "quiet_start" IS NULL AND "act_now_through_quiet" IS NULL)),
    CONSTRAINT "notification_preferences_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "notification_preferences_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "notification_preferences_person_key" ON "notification_preferences"("user_id") WHERE "deal_id" IS NULL;
CREATE UNIQUE INDEX "notification_preferences_pact_key" ON "notification_preferences"("user_id", "deal_id") WHERE "deal_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Row-level security. A person reads only their own notifications, in the organization their session
-- is in, on pacts they are still on, and a buyer-only item only while on the pact's own side.
-- ---------------------------------------------------------------------------
ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_events FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;

GRANT SELECT ON notifications, notification_events, notification_deliveries TO pactlab_app;
GRANT UPDATE ("read_at") ON notifications TO pactlab_app;
GRANT SELECT, INSERT, UPDATE ON notification_preferences TO pactlab_app;

CREATE POLICY notifications_own ON notifications FOR SELECT TO pactlab_app
  USING (
    user_id = app_current_user_id()
    AND organization_id = app_current_organization_id()
    AND deal_id = ANY (app_current_deal_ids())
    AND (visibility = 'SHARED' OR app_is_buyer_side(deal_id))
  );
CREATE POLICY notifications_own_read ON notifications FOR UPDATE TO pactlab_app
  USING (user_id = app_current_user_id() AND organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()))
  WITH CHECK (user_id = app_current_user_id() AND organization_id = app_current_organization_id());
-- An event is readable only through a notification of one's own.
CREATE POLICY notification_events_own ON notification_events FOR SELECT TO pactlab_app
  USING (EXISTS (SELECT 1 FROM notifications n WHERE n.event_id = notification_events.id));
CREATE POLICY notification_deliveries_own ON notification_deliveries FOR SELECT TO pactlab_app
  USING (user_id = app_current_user_id());
CREATE POLICY notification_preferences_own_select ON notification_preferences FOR SELECT TO pactlab_app
  USING (user_id = app_current_user_id());
CREATE POLICY notification_preferences_own_insert ON notification_preferences FOR INSERT TO pactlab_app
  WITH CHECK (user_id = app_current_user_id() AND (deal_id IS NULL OR (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()))));
CREATE POLICY notification_preferences_own_update ON notification_preferences FOR UPDATE TO pactlab_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id() AND (deal_id IS NULL OR (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()))));

-- The definer functions below run as pactlab_auth (like the signing recorder): it writes events,
-- recipients and deliveries, and reads what the dispatcher needs.
GRANT SELECT, INSERT, UPDATE ON notification_events, notifications, notification_deliveries TO pactlab_auth;
GRANT SELECT ON notification_preferences TO pactlab_auth;
GRANT SELECT ("id", "organization_id", "deal_id", "respond_by") ON loi_versions TO pactlab_auth;
CREATE POLICY notification_events_auth ON notification_events FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY notifications_auth ON notifications FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY notification_deliveries_auth ON notification_deliveries FOR ALL TO pactlab_auth USING (true) WITH CHECK (true);
CREATE POLICY notification_preferences_auth ON notification_preferences FOR SELECT TO pactlab_auth USING (true);

-- ---------------------------------------------------------------------------
-- Recording. The recipient rule, in one place:
-- - active members of the pact, in the pact's organization, never the person who made the change
--   (unless the event is the person's own, e.g. their sync finished);
-- - never an investor (they see only the published investor view);
-- - a buyer-only event never reaches a counterparty (target contributor, bidder);
-- - a bidder only hears of their own bid;
-- - then the audience narrows it (everyone, own side, counterparty, own leads, named people).
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_notify_insert(p_org uuid, p_deal uuid, p_actor uuid, p_type text, p_urgency text, p_dedupe text, p_link text,
                                  p_visibility text, p_audience text, p_bid uuid, p_users uuid[], p_include_actor boolean)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_event uuid;
  v_count integer;
BEGIN
  IF p_audience NOT IN ('ALL', 'OWN_SIDE', 'COUNTERPARTY', 'OWN_LEADS', 'USERS') THEN
    RAISE EXCEPTION 'unknown audience' USING ERRCODE = '22023';
  END IF;
  INSERT INTO notification_events (id, organization_id, deal_id, type, urgency, dedupe_key, link_path, visibility, actor_user_id)
  VALUES (uuidv7(), p_org, p_deal, p_type, p_urgency, p_dedupe, p_link, p_visibility, p_actor)
  ON CONFLICT (organization_id, deal_id, dedupe_key) DO NOTHING
  RETURNING id INTO v_event;
  IF v_event IS NULL THEN RETURN 0; END IF;
  INSERT INTO notifications (id, organization_id, deal_id, event_id, user_id, urgency, visibility)
  SELECT uuidv7(), p_org, p_deal, v_event, m.user_id, p_urgency, p_visibility
    FROM deal_memberships m
   WHERE m.organization_id = p_org AND m.deal_id = p_deal AND m.status = 'ACTIVE'
     AND (p_include_actor OR p_actor IS NULL OR m.user_id <> p_actor)
     AND m.role::text <> 'INVESTOR'
     AND (p_visibility = 'SHARED' OR m.role::text NOT IN ('TARGET_CONTRIBUTOR', 'BIDDER'))
     AND (m.role::text <> 'BIDDER' OR (p_bid IS NOT NULL AND m.bid_id = p_bid))
     AND CASE p_audience
           WHEN 'ALL' THEN true
           WHEN 'OWN_SIDE' THEN m.role::text NOT IN ('TARGET_CONTRIBUTOR', 'BIDDER')
           WHEN 'COUNTERPARTY' THEN m.role::text IN ('TARGET_CONTRIBUTOR', 'BIDDER')
           WHEN 'OWN_LEADS' THEN m.role::text = 'DEAL_LEAD'
           ELSE m.user_id = ANY (coalesce(p_users, '{}'::uuid[]))
         END
  ON CONFLICT (event_id, user_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
ALTER FUNCTION app_notify_insert(uuid, uuid, uuid, text, text, text, text, text, text, uuid, uuid[], boolean) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_notify_insert(uuid, uuid, uuid, text, text, text, text, text, text, uuid, uuid[], boolean) FROM PUBLIC;

-- Called by application code inside the transaction that makes the change, as the person making it:
-- the pact must be theirs. (A buyer-only event a counterparty's change causes, such as a draft finding
-- from the rules run on their import, still reaches only the own side: the recipient rule decides.)
-- Returns the recipients added (0 when the event was already recorded).
CREATE FUNCTION app_notify(p_deal uuid, p_type text, p_urgency text, p_dedupe text, p_link text, p_visibility text,
                           p_audience text, p_bid uuid, p_users uuid[], p_include_actor boolean)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_org uuid := app_current_organization_id();
  v_actor uuid := app_current_user_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM deal_memberships m
                  WHERE m.organization_id = v_org AND m.deal_id = p_deal AND m.user_id = v_actor AND m.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'not on this pact' USING ERRCODE = '42501';
  END IF;
  RETURN app_notify_insert(v_org, p_deal, v_actor, p_type, p_urgency, p_dedupe, p_link, p_visibility, p_audience, p_bid, p_users, p_include_actor);
END
$$;
ALTER FUNCTION app_notify(uuid, text, text, text, text, text, text, uuid, uuid[], boolean) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_notify(uuid, text, text, text, text, text, text, uuid, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_notify(uuid, text, text, text, text, text, text, uuid, uuid[], boolean) TO pactlab_app;

-- Deadlines within 48 hours, across organizations (the dispatcher's sweep): a countersigned letter's
-- exclusivity ending, and a sent letter's answer-by date. Once per letter and deadline.
CREATE FUNCTION app_notify_deadlines(p_now timestamptz)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_row record;
  v_total integer := 0;
BEGIN
  FOR v_row IN
    SELECT l.id, l.organization_id, l.deal_id, 'exclusivity' AS kind FROM loi_versions l
     WHERE l.status = 'COUNTERSIGNED' AND l.exclusivity_ends_at > p_now AND l.exclusivity_ends_at <= p_now + interval '48 hours'
    UNION ALL
    SELECT l.id, l.organization_id, l.deal_id, 'answer-by' FROM loi_versions l
     WHERE l.status = 'SENT' AND l.respond_by > p_now AND l.respond_by <= p_now + interval '48 hours'
    LIMIT 500
  LOOP
    v_total := v_total + app_notify_insert(v_row.organization_id, v_row.deal_id, NULL, 'DEADLINE_NEAR', 'ACT_NOW',
      'loi:' || v_row.id || ':' || v_row.kind, '/deals/' || v_row.deal_id || '/loi', 'SHARED', 'ALL', NULL, NULL, false);
  END LOOP;
  RETURN v_total;
END
$$;
ALTER FUNCTION app_notify_deadlines(timestamptz) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_notify_deadlines(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_notify_deadlines(timestamptz) TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Dispatch (no tenant session: the dispatcher works across organizations). Email addresses are read
-- here only to send; the pact's name is the only pact content an email carries.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_notification_pending_page(p_after uuid, p_limit integer)
  RETURNS TABLE (notification_id uuid, user_id uuid, organization_id uuid, deal_id uuid, deal_name text, type text,
                 urgency text, link_path text, created_at timestamptz, email text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  SELECT n.id, n.user_id, n.organization_id, n.deal_id, d.name, e.type, n.urgency, e.link_path, n.created_at, u.email
    FROM notifications n
    JOIN notification_events e ON e.id = n.event_id
    JOIN deals d ON d.organization_id = n.organization_id AND d.id = n.deal_id
    JOIN users u ON u.id = n.user_id
   WHERE n.email_status = 'PENDING' AND (p_after IS NULL OR n.id > p_after)
   ORDER BY n.id
   LIMIT least(greatest(p_limit, 1), 500)
$$;
ALTER FUNCTION app_notification_pending_page(uuid, integer) OWNER TO pactlab_auth;

-- Settings for the people in a page: their own row, their pact overrides, and their last digest.
CREATE FUNCTION app_notification_settings(p_users uuid[])
  RETURNS TABLE (user_id uuid, deal_id uuid, act_now text, fyi text, digest text, time_zone text, quiet_start smallint,
                 quiet_end smallint, act_now_through_quiet boolean, last_digest_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  SELECT p.user_id, p.deal_id, p.act_now, p.fyi, p.digest, p.time_zone, p.quiet_start, p.quiet_end, p.act_now_through_quiet, NULL::timestamptz
    FROM notification_preferences p WHERE p.user_id = ANY (p_users)
  UNION ALL
  SELECT d.user_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, max(d.claimed_at)
    FROM notification_deliveries d WHERE d.user_id = ANY (p_users) AND d.kind = 'DIGEST' GROUP BY d.user_id
$$;
ALTER FUNCTION app_notification_settings(uuid[]) OWNER TO pactlab_auth;

-- Claim pending notifications of one person for one email, before it is sent. A claimed row is never
-- claimed again, so a retry or a second dispatcher never sends it twice (at most once). Returns the
-- delivery id, or null when nothing was left to claim.
CREATE FUNCTION app_notification_claim(p_user uuid, p_kind text, p_ids uuid[])
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_delivery uuid := uuidv7();
  v_count integer;
BEGIN
  UPDATE notifications SET delivery_id = v_delivery, email_status = 'SENDING'
   WHERE id = ANY (p_ids) AND user_id = p_user AND email_status = 'PENDING';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN RETURN NULL; END IF;
  INSERT INTO notification_deliveries (id, user_id, kind, items) VALUES (v_delivery, p_user, p_kind, v_count);
  RETURN v_delivery;
END
$$;
ALTER FUNCTION app_notification_claim(uuid, text, uuid[]) OWNER TO pactlab_auth;

-- The outcome of a claimed email; once.
CREATE FUNCTION app_notification_finish(p_delivery uuid, p_status text, p_error text)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_status NOT IN ('SENT', 'SUPPRESSED', 'FAILED') THEN RAISE EXCEPTION 'unknown outcome' USING ERRCODE = '22023'; END IF;
  UPDATE notification_deliveries SET status = p_status, error_class = p_error, finished_at = now()
   WHERE id = p_delivery AND status = 'CLAIMED';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN RETURN false; END IF;
  UPDATE notifications SET email_status = p_status WHERE delivery_id = p_delivery;
  RETURN true;
END
$$;
ALTER FUNCTION app_notification_finish(uuid, text, text) OWNER TO pactlab_auth;

-- Pending notifications that are never emailed: in-app only by preference, or no address to send to.
CREATE FUNCTION app_notification_settle(p_ids uuid[], p_status text)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_status NOT IN ('IN_APP_ONLY', 'NO_ADDRESS') THEN RAISE EXCEPTION 'unknown outcome' USING ERRCODE = '22023'; END IF;
  UPDATE notifications SET email_status = p_status WHERE id = ANY (p_ids) AND email_status = 'PENDING';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
ALTER FUNCTION app_notification_settle(uuid[], text) OWNER TO pactlab_auth;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['app_notification_pending_page(uuid, integer)', 'app_notification_settings(uuid[])', 'app_notification_claim(uuid, text, uuid[])',
                            'app_notification_finish(uuid, text, text)', 'app_notification_settle(uuid[], text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
