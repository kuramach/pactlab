-- Batch 1 after T-105 (Kumar, 2026-11-06). Expand-only:
--   1. the seller answers proposed terms (accept, reject, counter); a version both sides
--      accept is Agreed and frozen;
--   2. user-defined Foresight metrics;
--   3. sign-up opens the first session when the new organization is active (no second code);
--   4. re-grant a column the sign-in role needs, for databases that applied pact_guests early.
-- Rollback: drop term_responses, foresight_custom_metrics and the new functions; restore
-- app_signup_verify from 20261007000000_signup and the trigger function from 20261124000000.

-- 1. Seller responses. Append-only; the newest response per term counts.
ALTER TABLE "term_proposal_batches" ADD COLUMN "agreed_at" TIMESTAMPTZ(3),
  ADD CONSTRAINT "term_proposal_batches_agreed_check" CHECK ("agreed_at" IS NULL OR "proposed_at" IS NOT NULL);

CREATE TABLE "term_responses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "counter_amount" DECIMAL(20,2),
    "note" TEXT NOT NULL DEFAULT '',
    "responded_by" UUID NOT NULL,
    "responded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "term_responses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "term_responses_decision_check" CHECK ("decision" IN ('ACCEPT', 'REJECT', 'COUNTER')),
    CONSTRAINT "term_responses_counter_check" CHECK (("decision" = 'COUNTER') = ("counter_amount" IS NOT NULL) AND ("counter_amount" IS NULL OR "counter_amount" >= 0)),
    CONSTRAINT "term_responses_note_check" CHECK (length("note") <= 1000)
);
CREATE INDEX "term_responses_batch_idx" ON "term_responses"("batch_id", "ordinal", "responded_at");
ALTER TABLE "term_responses" ADD CONSTRAINT "term_responses_term_fkey" FOREIGN KEY ("batch_id", "ordinal") REFERENCES "term_proposals"("batch_id", "ordinal") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "term_responses" ADD CONSTRAINT "term_responses_batch_fkey" FOREIGN KEY ("organization_id", "deal_id", "batch_id") REFERENCES "term_proposal_batches"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The batch the seller may still answer: proposed, not agreed, and not superseded by a later proposal.
CREATE FUNCTION app_terms_open_for_response(p_batch uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM term_proposal_batches b
       WHERE b.id = p_batch AND b.proposed_at IS NOT NULL AND b.agreed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM term_proposal_batches n
                          WHERE n.organization_id = b.organization_id AND n.deal_id = b.deal_id
                            AND n.version > b.version AND n.proposed_at IS NOT NULL))
  $$;
-- True when every term of the batch has a latest response of ACCEPT.
CREATE FUNCTION app_terms_all_accepted(p_batch uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (SELECT 1 FROM term_proposals t WHERE t.batch_id = p_batch)
       AND NOT EXISTS (
         SELECT 1 FROM term_proposals t
          WHERE t.batch_id = p_batch
            AND COALESCE((SELECT r.decision FROM term_responses r
                           WHERE r.batch_id = t.batch_id AND r.ordinal = t.ordinal
                           ORDER BY r.responded_at DESC, r.id DESC LIMIT 1), 'NONE') <> 'ACCEPT')
  $$;

-- A proposed batch is frozen except for being marked agreed once, when every term is accepted.
CREATE OR REPLACE FUNCTION app_term_proposals_frozen() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_TABLE_NAME = 'term_proposal_batches' THEN
    IF OLD.proposed_at IS NOT NULL THEN
      IF OLD.agreed_at IS NULL AND NEW.agreed_at IS NOT NULL
         AND (to_jsonb(NEW) - 'agreed_at') = (to_jsonb(OLD) - 'agreed_at') AND app_terms_all_accepted(OLD.id) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'term proposal batch % is already proposed', OLD.id;
    END IF;
    IF NEW.proposed_at IS NULL OR NEW.agreed_at IS NOT NULL
       OR (to_jsonb(NEW) - 'proposed_at' - 'proposed_by') <> (to_jsonb(OLD) - 'proposed_at' - 'proposed_by') THEN
      RAISE EXCEPTION 'a term proposal batch only changes by being proposed';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM term_proposal_batches b WHERE b.id = OLD.batch_id AND b.proposed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'terms of proposed batch % are frozen', OLD.batch_id;
    END IF;
    IF (to_jsonb(NEW) - 'seller_note') <> (to_jsonb(OLD) - 'seller_note') THEN
      RAISE EXCEPTION 'only the seller note of a draft term changes';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

GRANT SELECT, INSERT ON term_responses TO pactlab_app;
GRANT UPDATE ("agreed_at") ON term_proposal_batches TO pactlab_app;
ALTER TABLE term_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE term_responses FORCE ROW LEVEL SECURITY;
-- Both sides read responses to proposed terms.
CREATE POLICY term_responses_read ON term_responses FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
-- Only the seller's contributors answer, as themselves, on the batch still open.
CREATE POLICY term_responses_seller_insert ON term_responses FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND responded_by = app_current_user_id()
    AND EXISTS (SELECT 1 FROM deal_memberships m
                 WHERE m.organization_id = term_responses.organization_id AND m.deal_id = term_responses.deal_id
                   AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE' AND m.role = 'TARGET_CONTRIBUTOR')
    AND app_terms_open_for_response(batch_id));
-- Whoever completes the acceptance marks the batch agreed; the trigger re-checks every term.
CREATE POLICY term_proposal_batches_agree ON term_proposal_batches FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND proposed_at IS NOT NULL AND agreed_at IS NULL)
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND agreed_at IS NOT NULL);

-- 2. User-defined Foresight metrics (buyer-side, like the other Foresight tables).
CREATE TABLE "foresight_custom_metrics" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "metric_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "neutral" DECIMAL(9,4) NOT NULL,
    "effect" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "foresight_custom_metrics_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "foresight_custom_metrics_key_check" CHECK ("metric_key" ~ '^custom\.[a-z0-9-]{1,40}$'),
    CONSTRAINT "foresight_custom_metrics_effect_check" CHECK ("effect" IN ('GROWTH', 'RISK', 'TRACK')),
    CONSTRAINT "foresight_custom_metrics_text_check" CHECK (length(btrim("label")) BETWEEN 2 AND 80 AND length(btrim("definition")) BETWEEN 3 AND 300),
    CONSTRAINT "foresight_custom_metrics_neutral_check" CHECK ("neutral" BETWEEN -50 AND 100)
);
CREATE UNIQUE INDEX "foresight_custom_metrics_key_key" ON "foresight_custom_metrics"("organization_id", "deal_id", "metric_key");
ALTER TABLE "foresight_custom_metrics" ADD CONSTRAINT "foresight_custom_metrics_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
GRANT SELECT, INSERT ON foresight_custom_metrics TO pactlab_app;
GRANT UPDATE ("archived_at") ON foresight_custom_metrics TO pactlab_app;
ALTER TABLE foresight_custom_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE foresight_custom_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY foresight_custom_metrics_buyer_side ON foresight_custom_metrics FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));

-- 3. Sign-up opens the first session when the organization is active: the sign-up code
--    just proved the address, so a second sign-in code adds nothing. Never while pending.
DROP FUNCTION app_signup_verify(text, text, boolean);
CREATE FUNCTION app_signup_verify(p_email text, p_code_hash text, p_requires_approval boolean)
  RETURNS TABLE (organization_id uuid, slug text, status organization_status, owner_user_id uuid,
                 organization_name text, owner_name text, sso_requested boolean,
                 session_id uuid, session_expires_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_email text := lower(btrim(p_email));
  v_challenge signup_challenges%ROWTYPE;
  v_org uuid := uuidv7();
  v_user uuid := uuidv7();
  v_slug text;
  v_status organization_status := CASE WHEN p_requires_approval THEN 'PENDING_APPROVAL' ELSE 'ACTIVE' END;
  v_session uuid;
  v_expires timestamptz;
BEGIN
  SELECT * INTO v_challenge FROM signup_challenges c
   WHERE c.email = v_email AND c.consumed_at IS NULL AND c.expires_at > now() AND c.attempts < 5
   ORDER BY c.created_at DESC LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_challenge.code_hash <> p_code_hash THEN
    UPDATE signup_challenges SET attempts = attempts + 1 WHERE id = v_challenge.id;
    RETURN;
  END IF;
  -- The address was claimed between start and verify: no second account.
  IF EXISTS (SELECT 1 FROM users u WHERE u.email = v_email) THEN
    UPDATE signup_challenges SET consumed_at = now() WHERE id = v_challenge.id;
    RETURN;
  END IF;

  v_slug := left(btrim(regexp_replace(lower(v_challenge.organization_name), '[^a-z0-9]+', '-', 'g'), '-'), 40);
  v_slug := CASE WHEN v_slug = '' THEN 'org' ELSE v_slug END || '-' || right(replace(v_org::text, '-', ''), 6);

  INSERT INTO organizations (id, name, slug, auth_method, status, sso_requested, created_via, updated_at)
  VALUES (v_org, v_challenge.organization_name, v_slug, 'EMAIL_CODE', v_status, v_challenge.sso_requested, 'SIGNUP', now());
  INSERT INTO users (id, auth0_subject, display_name, email)
  VALUES (v_user, 'pactlab|' || v_user::text, v_challenge.display_name, v_email);
  INSERT INTO organization_memberships (id, organization_id, user_id, role)
  VALUES (uuidv7(), v_org, v_user, 'ORG_OWNER');
  UPDATE signup_challenges SET consumed_at = now(), organization_id = v_org WHERE id = v_challenge.id;
  INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
  VALUES (uuidv7(), v_org, NULL, v_user, 'org.signup', 'organization', v_org::text, 'SUCCEEDED');

  IF v_status = 'ACTIVE' THEN
    v_session := uuidv7();
    v_expires := now() + interval '8 hours';
    INSERT INTO auth_sessions (id, user_id, organization_id, expires_at) VALUES (v_session, v_user, v_org, v_expires);
    PERFORM app_auth_audit(v_user, 'login.succeeded', 'SUCCEEDED');
  END IF;

  RETURN QUERY SELECT v_org, v_slug, v_status, v_user, v_challenge.organization_name, v_challenge.display_name,
                      v_challenge.sso_requested, v_session, v_expires;
END
$$;
ALTER FUNCTION app_signup_verify(text, text, boolean) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_signup_verify(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_signup_verify(text, text, boolean) TO pactlab_app;

-- 4. Databases that applied 20261111000000_pact_guests before this grant was added to it.
GRANT SELECT (name) ON organizations TO pactlab_auth;
