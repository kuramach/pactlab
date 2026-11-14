-- Email delivery events and the in-app do-not-send list (T-109, ADR 0032). SES publishes bounce,
-- complaint, delivery, reject and rendering-failure events to SNS; the API verifies each
-- notification and records it here. A hard bounce or a complaint puts the address on the list,
-- and the sender refuses it before calling SES. SES account-level suppression stays the floor.
-- Addresses are never stored: only a keyed hash (HMAC with the API's secret) and the domain.
-- Expand-only: two new tables and new functions. Rollback: drop the functions and the tables.

CREATE TABLE "email_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "recipient_hash" CHAR(64) NOT NULL,
    "recipient_domain" TEXT NOT NULL,
    "ses_message_id" TEXT NOT NULL,
    "sns_message_id" TEXT NOT NULL,
    "bounce_type" TEXT,
    "bounce_subtype" TEXT,
    "diagnostic" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_events_type_check" CHECK ("event_type" IN ('BOUNCE', 'COMPLAINT', 'DELIVERY', 'REJECT', 'RENDERING_FAILURE')),
    CONSTRAINT "email_events_domain_check" CHECK (char_length("recipient_domain") BETWEEN 1 AND 253),
    CONSTRAINT "email_events_diagnostic_check" CHECK ("diagnostic" IS NULL OR char_length("diagnostic") <= 500)
);
-- SNS delivers at least once: the same notification for the same recipient is recorded once.
CREATE UNIQUE INDEX "email_events_once_idx" ON "email_events"("sns_message_id", "recipient_hash");
CREATE INDEX "email_events_received_idx" ON "email_events"("received_at");

CREATE TABLE "email_suppressions" (
    "recipient_hash" CHAR(64) NOT NULL,
    "reason" TEXT NOT NULL,
    "first_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "events" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("recipient_hash"),
    CONSTRAINT "email_suppressions_reason_check" CHECK ("reason" IN ('HARD_BOUNCE', 'COMPLAINT'))
);

ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_events FORCE ROW LEVEL SECURITY;
ALTER TABLE email_suppressions FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON email_events TO pactlab_ops;
GRANT SELECT, INSERT, UPDATE ON email_suppressions TO pactlab_ops;
CREATE POLICY email_events_ops ON email_events FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);
CREATE POLICY email_suppressions_ops ON email_suppressions FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);

-- Record one verified event for one recipient. A permanent bounce or a complaint suppresses the address.
-- Returns whether the event was new (false for a redelivered notification).
CREATE FUNCTION app_email_event_record(p_type text, p_recipient_hash text, p_domain text, p_ses_message_id text, p_sns_message_id text,
                                       p_bounce_type text, p_bounce_subtype text, p_diagnostic text, p_occurred_at timestamptz)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_reason text;
  v_inserted integer;
BEGIN
  INSERT INTO email_events (id, event_type, recipient_hash, recipient_domain, ses_message_id, sns_message_id, bounce_type, bounce_subtype, diagnostic, occurred_at)
  VALUES (uuidv7(), p_type, p_recipient_hash, lower(p_domain), p_ses_message_id, p_sns_message_id, p_bounce_type, p_bounce_subtype, left(p_diagnostic, 500), p_occurred_at)
  ON CONFLICT (sns_message_id, recipient_hash) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN RETURN false; END IF;
  v_reason := CASE WHEN p_type = 'COMPLAINT' THEN 'COMPLAINT' WHEN p_type = 'BOUNCE' AND p_bounce_type = 'Permanent' THEN 'HARD_BOUNCE' END;
  IF v_reason IS NOT NULL THEN
    INSERT INTO email_suppressions (recipient_hash, reason) VALUES (p_recipient_hash, v_reason)
    ON CONFLICT (recipient_hash) DO UPDATE SET last_at = now(), events = email_suppressions.events + 1,
      -- A complaint outranks a bounce: the person asked not to be mailed.
      reason = CASE WHEN EXCLUDED.reason = 'COMPLAINT' THEN 'COMPLAINT' ELSE email_suppressions.reason END;
  END IF;
  RETURN true;
END
$$;

-- The sender's check before every send.
CREATE FUNCTION app_email_suppressed(p_recipient_hash text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT reason FROM email_suppressions WHERE recipient_hash = p_recipient_hash $$;

-- Operators: event counts by type over the last p_days, and the size of the list.
CREATE FUNCTION app_ops_email_health(p_actor uuid, p_days integer)
  RETURNS TABLE (event_type text, events bigint, suppressed bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT t.event_type, coalesce(c.events, 0), (SELECT count(*) FROM email_suppressions)
      FROM unnest(ARRAY['DELIVERY', 'BOUNCE', 'COMPLAINT', 'REJECT', 'RENDERING_FAILURE']) AS t(event_type)
      LEFT JOIN (SELECT e.event_type, count(*) AS events FROM email_events e WHERE e.received_at > now() - make_interval(days => least(greatest(p_days, 1), 90)) GROUP BY e.event_type) c
        ON c.event_type = t.event_type;
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['app_email_event_record(text, text, text, text, text, text, text, text, timestamptz)', 'app_email_suppressed(text)', 'app_ops_email_health(uuid, integer)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
