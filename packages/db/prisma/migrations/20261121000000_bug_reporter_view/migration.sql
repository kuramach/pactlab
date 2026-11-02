-- Bugs submitted (reporter view): a reporter opens their own reports and reads Pactlab's reply.
-- Expand-only: a new column and new functions; the existing ones stay for the running release.

-- Pactlab's reply to the reporter (they see it). internal_notes stays operators-only.
ALTER TABLE "bug_reports" ADD COLUMN "reporter_note" TEXT;
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_reporter_note_check" CHECK ("reporter_note" IS NULL OR length("reporter_note") <= 5000);
GRANT UPDATE (reporter_note) ON bug_reports TO pactlab_ops;

-- The caller's own reports, newest activity first. Never internal notes, fingerprint or context beyond the page.
CREATE FUNCTION app_bug_mine_list(p_actor uuid)
  RETURNS TABLE (id uuid, number integer, deal_id uuid, trigger text, title text, severity text, status text, occurrences integer,
                 first_seen_at timestamptz, last_seen_at timestamptz, updated_at timestamptz, route text, has_screenshot boolean, has_reply boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT b.id, b.number, b.deal_id, b.trigger, b.title, b.severity, b.status, b.occurrences,
           b.first_seen_at::timestamptz, b.last_seen_at::timestamptz, b.updated_at::timestamptz, b.context->>'route',
           b.screenshot IS NOT NULL, b.reporter_note IS NOT NULL AND b.reporter_note <> ''
      FROM bug_reports b
     WHERE b.reporter_user_id = p_actor
     ORDER BY b.last_seen_at DESC
     LIMIT 500;
$$;

-- One of the caller's own reports, with what they wrote, the reply and the screenshot. No row for anyone else's.
CREATE FUNCTION app_bug_mine_get(p_actor uuid, p_id uuid)
  RETURNS TABLE (id uuid, number integer, deal_id uuid, trigger text, title text, severity text, status text, occurrences integer,
                 first_seen_at timestamptz, last_seen_at timestamptz, updated_at timestamptz, route text, has_screenshot boolean, has_reply boolean,
                 what_happened text, expected text, reporter_note text, screenshot bytea, screenshot_type text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT b.id, b.number, b.deal_id, b.trigger, b.title, b.severity, b.status, b.occurrences,
           b.first_seen_at::timestamptz, b.last_seen_at::timestamptz, b.updated_at::timestamptz, b.context->>'route',
           b.screenshot IS NOT NULL, b.reporter_note IS NOT NULL AND b.reporter_note <> '',
           b.what_happened, b.expected, b.reporter_note, b.screenshot, b.screenshot_type
      FROM bug_reports b
     WHERE b.id = p_id AND b.reporter_user_id = p_actor;
$$;

-- Operators: the reporter's reply is part of the operator's own bug view (app_bug_get is unchanged).
CREATE FUNCTION app_bug_reply_get(p_actor uuid, p_id uuid) RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN (SELECT reporter_note FROM bug_reports WHERE bug_reports.id = p_id);
END
$$;

-- Triage, now with the reply to the reporter. app_bug_triage stays until the release that stops calling it.
CREATE FUNCTION app_bug_triage_v2(p_actor uuid, p_id uuid, p_status text, p_severity text, p_notes text, p_reporter_note text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE v_org uuid;
BEGIN
  PERFORM app_ops_require(p_actor);
  UPDATE bug_reports SET status = p_status, severity = p_severity, internal_notes = p_notes, reporter_note = NULLIF(p_reporter_note, ''), updated_at = now()
   WHERE bug_reports.id = p_id RETURNING organization_id INTO v_org;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM app_ops_audit(p_actor, v_org, 'bug.triaged', 'bug_report', p_id);
  RETURN true;
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_bug_mine_list(uuid)', 'app_bug_mine_get(uuid, uuid)', 'app_bug_reply_get(uuid, uuid)',
    'app_bug_triage_v2(uuid, uuid, text, text, text, text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
