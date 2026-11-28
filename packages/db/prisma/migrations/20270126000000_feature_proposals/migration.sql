-- T-176: feature requests from the help chat become triageable proposals. Expand only: two new tables,
-- one sequence, new functions and one widened audit policy; nothing existing changes shape.
-- Rollback: drop the functions app_feature_*, the two tables and the sequence, and restore the audit_events_ops
-- policy from 20261203000000_demo_shares (without 'feature_request.%'). No other table refers to them.
--
-- A proposal is product feedback only (the requester's own wording as confirmed in chat; never pact data).
-- Like bug reports, the tables are reached only through SECURITY DEFINER functions owned by `pactlab_ops`:
-- the runtime role has no policy on them, so a user cannot read another's request, and operators act only
-- through functions that check app_ops_require first.

CREATE SEQUENCE "feature_proposal_number_seq";

CREATE TABLE "feature_proposals" (
    "id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "decision_reason" TEXT,
    "info_question" TEXT,
    "info_reply" TEXT,
    "related_id" UUID,
    "task_spec" JSONB,
    "task_id" TEXT,
    "pull_request_url" TEXT,
    "whats_new_url" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feature_proposals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feature_proposals_number_key" UNIQUE ("number"),
    CONSTRAINT "feature_proposals_surface_check" CHECK ("surface" IN ('SITE', 'APP')),
    CONSTRAINT "feature_proposals_status_check" CHECK ("status" IN ('SUBMITTED', 'IN_TRIAGE', 'INFO_REQUESTED', 'APPROVED', 'DECLINED', 'SHIPPED')),
    CONSTRAINT "feature_proposals_title_check" CHECK (length("title") BETWEEN 3 AND 200),
    CONSTRAINT "feature_proposals_task_id_check" CHECK ("task_id" IS NULL OR "task_id" ~ '^T-[0-9]{3,5}[a-z]?$'),
    CONSTRAINT "feature_proposals_related_fkey" FOREIGN KEY ("related_id") REFERENCES "feature_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "feature_proposals_status_idx" ON "feature_proposals"("status", "updated_at");

-- Every requester of a proposal: the first one (ORIGINAL), those the triager confirmed as the same ask
-- (CONFIRMED), and those the similarity screen suggested and nobody has confirmed yet (SUGGESTED).
CREATE TABLE "feature_proposal_supporters" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "organization_id" UUID,
    "user_id" UUID,
    "email" TEXT,
    "surface" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "grouped_as" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feature_proposal_supporters_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feature_proposal_supporters_grouped_as_check" CHECK ("grouped_as" IN ('ORIGINAL', 'SUGGESTED', 'CONFIRMED')),
    CONSTRAINT "feature_proposal_supporters_surface_check" CHECK ("surface" IN ('SITE', 'APP')),
    -- Anonymous drive-by requests are not stored: the site needs an address, the app needs a user and an organization.
    CONSTRAINT "feature_proposal_supporters_who_check" CHECK (
      ("surface" = 'SITE' AND "email" IS NOT NULL AND "user_id" IS NULL AND "organization_id" IS NULL)
      OR ("surface" = 'APP' AND "user_id" IS NOT NULL AND "organization_id" IS NOT NULL)
    ),
    CONSTRAINT "feature_proposal_supporters_proposal_fkey" FOREIGN KEY ("proposal_id") REFERENCES "feature_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "feature_proposal_supporters_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "feature_proposal_supporters_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "feature_proposal_supporters_proposal_idx" ON "feature_proposal_supporters"("proposal_id", "created_at");
CREATE INDEX "feature_proposal_supporters_user_idx" ON "feature_proposal_supporters"("user_id", "created_at");
CREATE INDEX "feature_proposal_supporters_email_idx" ON "feature_proposal_supporters"(lower("email"), "created_at");

ALTER TABLE feature_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE feature_proposal_supporters ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_proposal_supporters FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON feature_proposals, feature_proposal_supporters TO pactlab_ops;
GRANT USAGE ON SEQUENCE feature_proposal_number_seq TO pactlab_ops;
CREATE POLICY feature_proposals_ops ON feature_proposals FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);
CREATE POLICY feature_proposal_supporters_ops ON feature_proposal_supporters FOR ALL TO pactlab_ops USING (true) WITH CHECK (true);

DROP POLICY audit_events_ops ON audit_events;
CREATE POLICY audit_events_ops ON audit_events FOR ALL TO pactlab_ops USING (true)
  WITH CHECK (actor_user_id IS NULL OR action LIKE 'org.%' OR action LIKE 'member.%' OR action LIKE 'bug.%' OR action LIKE 'operator.%' OR action LIKE 'demo.%' OR action LIKE 'feature_request.%');

-- Intake (the API, for a requester it has verified) ------------------------------------------------

-- The proposals a new request is compared with: the 300 most recently touched. Titles and statuses only, never
-- who asked. Bounded: similarity is a suggestion for the triager, who confirms it.
CREATE FUNCTION app_feature_candidates()
  RETURNS TABLE (id uuid, title text, description text, status text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT p.id, p.title, p.description, p.status FROM feature_proposals p ORDER BY p.updated_at DESC, p.id DESC LIMIT 300 $$;

-- File a confirmed request. `p_match` is the proposal the similarity screen suggested, if any. A match that is
-- still live takes the request as a SUGGESTED supporter (the triager confirms it); a declined match is kept as
-- the earlier decision on a new proposal. Rate limits: 5 requests per person per day, 300 per hour on the site.
CREATE FUNCTION app_feature_file(
  p_org uuid, p_user uuid, p_email text, p_surface text, p_locale text, p_page text, p_title text, p_description text, p_transcript jsonb, p_match uuid
) RETURNS TABLE (outcome text, proposal_id uuid, number integer, earlier_status text, earlier_reason text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_match feature_proposals%ROWTYPE;
  v_id uuid;
  v_number integer;
  v_recent integer;
BEGIN
  IF p_surface = 'APP' THEN
    IF p_user IS NULL OR p_org IS NULL OR NOT EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = p_org AND m.user_id = p_user) THEN
      RAISE EXCEPTION 'requester is not a member' USING ERRCODE = '42501';
    END IF;
    SELECT count(*) INTO v_recent FROM feature_proposal_supporters s WHERE s.user_id = p_user AND s.created_at > now() - interval '1 day';
  ELSE
    IF p_email IS NULL OR p_email = '' THEN RAISE EXCEPTION 'an address is required' USING ERRCODE = '22023'; END IF;
    SELECT count(*) INTO v_recent FROM feature_proposal_supporters s WHERE lower(s.email) = lower(p_email) AND s.created_at > now() - interval '1 day';
    IF (SELECT count(*) FROM feature_proposal_supporters s WHERE s.surface = 'SITE' AND s.created_at > now() - interval '1 hour') >= 300 THEN
      RETURN QUERY SELECT 'RATE_LIMITED'::text, NULL::uuid, NULL::integer, NULL::text, NULL::text;
      RETURN;
    END IF;
  END IF;
  IF v_recent >= 5 THEN
    RETURN QUERY SELECT 'RATE_LIMITED'::text, NULL::uuid, NULL::integer, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF p_match IS NOT NULL THEN SELECT * INTO v_match FROM feature_proposals p WHERE p.id = p_match; END IF;

  IF v_match.id IS NOT NULL AND v_match.status <> 'DECLINED' THEN
    -- The same person asking twice is one supporter, not two.
    IF EXISTS (SELECT 1 FROM feature_proposal_supporters s WHERE s.proposal_id = v_match.id AND ((p_user IS NOT NULL AND s.user_id = p_user) OR (p_email IS NOT NULL AND lower(s.email) = lower(p_email)))) THEN
      RETURN QUERY SELECT 'ATTACHED'::text, v_match.id, v_match.number, NULL::text, NULL::text;
      RETURN;
    END IF;
    INSERT INTO feature_proposal_supporters (id, proposal_id, organization_id, user_id, email, surface, locale, page, title, description, transcript, grouped_as)
    VALUES (uuidv7(), v_match.id, p_org, p_user, p_email, p_surface, p_locale, p_page, p_title, p_description, p_transcript, 'SUGGESTED');
    UPDATE feature_proposals SET updated_at = now() WHERE feature_proposals.id = v_match.id;
    RETURN QUERY SELECT 'ATTACHED'::text, v_match.id, v_match.number, NULL::text, NULL::text;
    RETURN;
  END IF;

  v_id := uuidv7();
  v_number := nextval('feature_proposal_number_seq');
  INSERT INTO feature_proposals (id, number, title, description, surface, locale, page, related_id)
  VALUES (v_id, v_number, p_title, p_description, p_surface, p_locale, p_page, v_match.id);
  INSERT INTO feature_proposal_supporters (id, proposal_id, organization_id, user_id, email, surface, locale, page, title, description, transcript, grouped_as)
  VALUES (uuidv7(), v_id, p_org, p_user, p_email, p_surface, p_locale, p_page, p_title, p_description, p_transcript, 'ORIGINAL');
  RETURN QUERY SELECT 'CREATED'::text, v_id, v_number, v_match.status, v_match.decision_reason;
END
$$;

-- The caller's own requests, newest first, a page at a time. Never operator notes, other requesters or the task spec.
CREATE FUNCTION app_feature_mine_page(p_actor uuid, p_after_at timestamptz, p_after_id uuid, p_limit integer)
  RETURNS TABLE (id uuid, proposal_id uuid, number integer, title text, description text, grouped_as text, status text, decision_reason text, info_question text,
                 whats_new_url text, created_at timestamptz, updated_at timestamptz, total bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT s.id, p.id, p.number, s.title, s.description, s.grouped_as, p.status,
           CASE WHEN p.status = 'DECLINED' THEN p.decision_reason END,
           CASE WHEN p.status = 'INFO_REQUESTED' THEN p.info_question END,
           CASE WHEN p.status = 'SHIPPED' THEN p.whats_new_url END,
           s.created_at::timestamptz, greatest(p.updated_at, s.created_at)::timestamptz,
           (SELECT count(*) FROM feature_proposal_supporters m WHERE m.user_id = p_actor)
      FROM feature_proposal_supporters s JOIN feature_proposals p ON p.id = s.proposal_id
     WHERE s.user_id = p_actor AND (p_after_at IS NULL OR (s.created_at, s.id) < (p_after_at, p_after_id))
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT least(greatest(coalesce(p_limit, 51), 1), 101)
  $$;

-- A requester answers the question they were asked; the proposal goes back to triage.
CREATE FUNCTION app_feature_reply(p_actor uuid, p_proposal uuid, p_reply text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM feature_proposal_supporters s WHERE s.proposal_id = p_proposal AND s.user_id = p_actor) THEN RETURN false; END IF;
  UPDATE feature_proposals SET info_reply = p_reply, status = 'IN_TRIAGE', updated_at = now()
   WHERE feature_proposals.id = p_proposal AND status = 'INFO_REQUESTED';
  RETURN FOUND;
END
$$;

-- A proposal belongs to no organization (a site visitor has none), but the audit trail needs one: the operator's own.
CREATE FUNCTION app_feature_audit(p_actor uuid, p_action text, p_target uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE v_org uuid;
BEGIN
  SELECT m.organization_id INTO v_org FROM organization_memberships m WHERE m.user_id = p_actor ORDER BY m.organization_id LIMIT 1;
  IF v_org IS NOT NULL THEN PERFORM app_ops_audit(p_actor, v_org, p_action, 'feature_proposal', p_target); END IF;
END
$$;

-- Operators (Kumar) --------------------------------------------------------------------------------

CREATE FUNCTION app_feature_page(p_actor uuid, p_status text, p_query text, p_after_at timestamptz, p_after_id uuid, p_limit integer)
  RETURNS TABLE (id uuid, number integer, title text, surface text, locale text, page text, status text, decision_reason text, related_id uuid, task_id text,
                 supporters bigint, suggested bigint, created_at timestamptz, updated_at timestamptz, total bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE v_like text := '%' || replace(replace(replace(coalesce(p_query, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    WITH matching AS (
      SELECT p.* FROM feature_proposals p
       WHERE (p_status IS NULL OR p.status = p_status)
         AND (coalesce(p_query, '') = '' OR p.title ILIKE v_like OR p.description ILIKE v_like OR p.decision_reason ILIKE v_like)
    )
    SELECT m.id, m.number, m.title, m.surface, m.locale, m.page, m.status, m.decision_reason, m.related_id, m.task_id,
           (SELECT count(*) FROM feature_proposal_supporters s WHERE s.proposal_id = m.id AND s.grouped_as <> 'SUGGESTED'),
           (SELECT count(*) FROM feature_proposal_supporters s WHERE s.proposal_id = m.id AND s.grouped_as = 'SUGGESTED'),
           m.created_at::timestamptz, m.updated_at::timestamptz, (SELECT count(*) FROM matching)
      FROM matching m
     WHERE p_after_at IS NULL OR (m.updated_at, m.id) < (p_after_at, p_after_id)
     ORDER BY m.updated_at DESC, m.id DESC
     LIMIT least(greatest(coalesce(p_limit, 51), 1), 101);
END
$$;

CREATE FUNCTION app_feature_get(p_actor uuid, p_id uuid)
  RETURNS TABLE (id uuid, number integer, title text, description text, surface text, locale text, page text, status text, decision_reason text, info_question text,
                 info_reply text, related_id uuid, related_title text, related_status text, related_reason text, task_spec jsonb, task_id text,
                 pull_request_url text, whats_new_url text, created_at timestamptz, updated_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT p.id, p.number, p.title, p.description, p.surface, p.locale, p.page, p.status, p.decision_reason, p.info_question, p.info_reply,
           p.related_id, r.title, r.status, r.decision_reason, p.task_spec, p.task_id, p.pull_request_url, p.whats_new_url,
           p.created_at::timestamptz, p.updated_at::timestamptz
      FROM feature_proposals p LEFT JOIN feature_proposals r ON r.id = p.related_id
     WHERE p.id = p_id;
END
$$;

CREATE FUNCTION app_feature_supporters_page(p_actor uuid, p_proposal uuid, p_after_at timestamptz, p_after_id uuid, p_limit integer)
  RETURNS TABLE (id uuid, grouped_as text, surface text, locale text, page text, title text, description text, email text, user_id uuid, organization_id uuid,
                 organization_name text, transcript jsonb, created_at timestamptz, total bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT s.id, s.grouped_as, s.surface, s.locale, s.page, s.title, s.description, s.email, s.user_id, s.organization_id, o.name, s.transcript,
           s.created_at::timestamptz, (SELECT count(*) FROM feature_proposal_supporters t WHERE t.proposal_id = p_proposal)
      FROM feature_proposal_supporters s LEFT JOIN organizations o ON o.id = s.organization_id
     WHERE s.proposal_id = p_proposal AND (p_after_at IS NULL OR (s.created_at, s.id) > (p_after_at, p_after_id))
     ORDER BY s.created_at, s.id
     LIMIT least(greatest(coalesce(p_limit, 51), 1), 101);
END
$$;

-- Confirm that a suggested requester asked for the same thing, or split them into a proposal of their own.
-- Nothing merges until this is called: similarity only suggests.
CREATE FUNCTION app_feature_group(p_actor uuid, p_supporter uuid, p_confirm boolean) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_s feature_proposal_supporters%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM app_ops_require(p_actor);
  SELECT * INTO v_s FROM feature_proposal_supporters s WHERE s.id = p_supporter AND s.grouped_as = 'SUGGESTED' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_confirm THEN
    UPDATE feature_proposal_supporters SET grouped_as = 'CONFIRMED' WHERE feature_proposal_supporters.id = p_supporter;
    UPDATE feature_proposals SET updated_at = now() WHERE feature_proposals.id = v_s.proposal_id;
    PERFORM app_feature_audit(p_actor, 'feature_request.grouped', v_s.proposal_id);
    RETURN v_s.proposal_id;
  END IF;
  v_id := uuidv7();
  INSERT INTO feature_proposals (id, number, title, description, surface, locale, page)
  VALUES (v_id, nextval('feature_proposal_number_seq'), v_s.title, v_s.description, v_s.surface, v_s.locale, v_s.page);
  UPDATE feature_proposal_supporters SET proposal_id = v_id, grouped_as = 'ORIGINAL' WHERE feature_proposal_supporters.id = p_supporter;
  PERFORM app_feature_audit(p_actor, 'feature_request.split', v_id);
  RETURN v_id;
END
$$;

-- TRIAGE (take it up), DECLINE (with an optional reason), REQUEST_INFO (a question for the requester), REOPEN (their reply arrived).
CREATE FUNCTION app_feature_decide(p_actor uuid, p_id uuid, p_action text, p_note text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE v_status text;
BEGIN
  PERFORM app_ops_require(p_actor);
  IF p_action NOT IN ('TRIAGE', 'DECLINE', 'REQUEST_INFO', 'REOPEN') THEN RAISE EXCEPTION 'unknown action' USING ERRCODE = '22023'; END IF;
  IF p_action = 'REQUEST_INFO' AND coalesce(p_note, '') = '' THEN RAISE EXCEPTION 'a question is required' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_status FROM feature_proposals WHERE feature_proposals.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- An approved or shipped request has a task: it is not declined or reopened from here.
  IF v_status IN ('APPROVED', 'SHIPPED') THEN RETURN false; END IF;
  IF p_action = 'TRIAGE' THEN
    UPDATE feature_proposals SET status = 'IN_TRIAGE', updated_at = now() WHERE feature_proposals.id = p_id;
  ELSIF p_action = 'DECLINE' THEN
    UPDATE feature_proposals SET status = 'DECLINED', decision_reason = NULLIF(p_note, ''), decided_by = p_actor, decided_at = now(), updated_at = now() WHERE feature_proposals.id = p_id;
  ELSIF p_action = 'REQUEST_INFO' THEN
    UPDATE feature_proposals SET status = 'INFO_REQUESTED', info_question = p_note, info_reply = NULL, updated_at = now() WHERE feature_proposals.id = p_id;
  ELSE
    UPDATE feature_proposals SET status = 'IN_TRIAGE', info_reply = coalesce(NULLIF(p_note, ''), info_reply), updated_at = now() WHERE feature_proposals.id = p_id;
  END IF;
  PERFORM app_feature_audit(p_actor, 'feature_request.' || lower(p_action), p_id);
  RETURN true;
END
$$;

-- Approve: a task will exist. `p_spec` is what Kumar confirmed (Engine, Model, Lane, Context, Touches, Needs); the task
-- file itself is written by the triage-to-task workflow when the issue made from it is labelled `triage-approved`.
CREATE FUNCTION app_feature_approve(p_actor uuid, p_id uuid, p_spec jsonb) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  UPDATE feature_proposals SET status = 'APPROVED', task_spec = p_spec, decided_by = p_actor, decided_at = now(), decision_reason = NULL, updated_at = now()
   WHERE feature_proposals.id = p_id AND status IN ('SUBMITTED', 'IN_TRIAGE', 'INFO_REQUESTED', 'DECLINED');
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM app_feature_audit(p_actor, 'feature_request.approved', p_id);
  RETURN true;
END
$$;

-- Link the task the workflow wrote, its pull request, and (once built) the What's-new card: that marks it shipped.
CREATE FUNCTION app_feature_link(p_actor uuid, p_id uuid, p_task_id text, p_pull_request_url text, p_whats_new_url text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  UPDATE feature_proposals
     SET task_id = coalesce(NULLIF(p_task_id, ''), task_id), pull_request_url = coalesce(NULLIF(p_pull_request_url, ''), pull_request_url),
         whats_new_url = coalesce(NULLIF(p_whats_new_url, ''), whats_new_url),
         status = CASE WHEN coalesce(NULLIF(p_whats_new_url, ''), whats_new_url) IS NOT NULL THEN 'SHIPPED' ELSE status END,
         updated_at = now()
   WHERE feature_proposals.id = p_id AND status IN ('APPROVED', 'SHIPPED');
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM app_feature_audit(p_actor, 'feature_request.linked', p_id);
  RETURN true;
END
$$;

-- Who to email about a status change: the public-site requesters of one proposal (in-app requesters see it in the app). One page.
CREATE FUNCTION app_feature_site_requesters(p_actor uuid, p_id uuid)
  RETURNS TABLE (email text, locale text, title text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM app_ops_require(p_actor);
  RETURN QUERY
    SELECT DISTINCT ON (lower(s.email)) s.email, s.locale, s.title FROM feature_proposal_supporters s
     WHERE s.proposal_id = p_id AND s.surface = 'SITE' AND s.grouped_as <> 'SUGGESTED'
     ORDER BY lower(s.email), s.created_at
     LIMIT 500;
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'app_feature_candidates()',
    'app_feature_file(uuid, uuid, text, text, text, text, text, text, jsonb, uuid)',
    'app_feature_mine_page(uuid, timestamptz, uuid, integer)', 'app_feature_reply(uuid, uuid, text)',
    'app_feature_page(uuid, text, text, timestamptz, uuid, integer)', 'app_feature_get(uuid, uuid)',
    'app_feature_supporters_page(uuid, uuid, timestamptz, uuid, integer)', 'app_feature_group(uuid, uuid, boolean)',
    'app_feature_decide(uuid, uuid, text, text)', 'app_feature_approve(uuid, uuid, jsonb)',
    'app_feature_link(uuid, uuid, text, text, text)', 'app_feature_audit(uuid, text, uuid)', 'app_feature_site_requesters(uuid, uuid)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
