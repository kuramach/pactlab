-- T-097 (ADR 0015): seller-led sale. The seller opens the pact and invites
-- bidders (PE firms, corp-dev teams, investors). Each bidder sees the
-- seller's shared view, asks questions, then offers or passes. The new
-- boundary: bidders never see each other — not who they are, their
-- questions, private answers, offers or passes.
--
-- Expand only: new tables, nullable columns, and functions/policies that
-- extend the existing side model. Buyer-led pacts behave exactly as before.
-- Rollback: drop the new tables, columns and functions; restore
-- app_is_buyer_side, app_is_buyer_analyst, deal_memberships_select,
-- the deal_invitations checks and app_accept_deal_invitation from
-- 20261003000100, 20261011000000 and 20261111000000.

-- 1. Who opened the pact.
ALTER TABLE deals ADD COLUMN initiated_by text NOT NULL DEFAULT 'BUYER';
ALTER TABLE deals ADD CONSTRAINT deals_initiated_by_check CHECK (initiated_by IN ('BUYER', 'SELLER'));

-- 2. The process (one per seller-led pact) and the bids (one per bidding firm).
CREATE TABLE "sale_processes" (
    "deal_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "round" INTEGER NOT NULL DEFAULT 1,
    "offer_deadline" TIMESTAMPTZ(3),
    -- The seller's shared view: what every bidder may read.
    "shared_summary" TEXT,
    "data_room_url" TEXT,
    "nda_text" TEXT,
    "awarded_bid_id" UUID,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_processes_pkey" PRIMARY KEY ("organization_id", "deal_id"),
    CONSTRAINT "sale_processes_status_check" CHECK ("status" IN ('OPEN', 'AWARDED', 'CLOSED')),
    CONSTRAINT "sale_processes_round_check" CHECK ("round" BETWEEN 1 AND 5),
    CONSTRAINT "sale_processes_url_check" CHECK ("data_room_url" IS NULL OR "data_room_url" LIKE 'https://%')
);
ALTER TABLE "sale_processes" ADD CONSTRAINT "sale_processes_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "bids" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    -- The bidding firm, not a person.
    "firm_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "round" INTEGER NOT NULL DEFAULT 1,
    "nda_accepted_at" TIMESTAMPTZ(3),
    "nda_accepted_by" UUID,
    "pass_reason" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bids_status_check" CHECK ("status" IN ('INVITED', 'ACTIVE', 'OFFERED', 'PASSED', 'SHORTLISTED', 'DECLINED', 'WON')),
    CONSTRAINT "bids_firm_check" CHECK (length(btrim("firm_name")) BETWEEN 1 AND 200),
    CONSTRAINT "bids_pass_check" CHECK ("pass_reason" IS NULL OR length("pass_reason") <= 2000)
);
CREATE UNIQUE INDEX "bids_org_deal_id_key" ON "bids"("organization_id", "deal_id", "id");
CREATE INDEX "bids_org_deal_created_idx" ON "bids"("organization_id", "deal_id", "created_at");
ALTER TABLE "bids" ADD CONSTRAINT "bids_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Offers: every version kept; money as decimal with its currency.
CREATE TABLE "bid_offers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "bid_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "price" DECIMAL(24,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    -- For an investment round (Venture Raise): the pre-money valuation offered.
    "pre_money" DECIMAL(24,4),
    "structure" TEXT NOT NULL,
    "conditions" TEXT,
    "valid_until" DATE,
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_offers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bid_offers_price_check" CHECK ("price" > 0),
    CONSTRAINT "bid_offers_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "bid_offers_structure_check" CHECK (length("structure") BETWEEN 3 AND 4000),
    CONSTRAINT "bid_offers_conditions_check" CHECK ("conditions" IS NULL OR length("conditions") <= 4000)
);
CREATE UNIQUE INDEX "bid_offers_bid_version_key" ON "bid_offers"("organization_id", "deal_id", "bid_id", "version");
ALTER TABLE "bid_offers" ADD CONSTRAINT "bid_offers_bid_fkey" FOREIGN KEY ("organization_id", "deal_id", "bid_id") REFERENCES "bids"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Questions: private to the asking bidder until the seller publishes an answer to all.
CREATE TABLE "bid_questions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "bid_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "asked_by" UUID NOT NULL,
    "asked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answer" TEXT,
    "answer_scope" TEXT,
    "answered_by" UUID,
    "answered_at" TIMESTAMPTZ(3),

    CONSTRAINT "bid_questions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bid_questions_question_check" CHECK (length("question") BETWEEN 3 AND 4000),
    CONSTRAINT "bid_questions_scope_check" CHECK ("answer_scope" IS NULL OR "answer_scope" IN ('PRIVATE', 'ALL')),
    CONSTRAINT "bid_questions_answer_check" CHECK (("answer" IS NULL) = ("answer_scope" IS NULL) AND ("answer" IS NULL) = ("answered_at" IS NULL))
);
CREATE INDEX "bid_questions_org_deal_asked_idx" ON "bid_questions"("organization_id", "deal_id", "asked_at");
ALTER TABLE "bid_questions" ADD CONSTRAINT "bid_questions_bid_fkey" FOREIGN KEY ("organization_id", "deal_id", "bid_id") REFERENCES "bids"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An answer to all bidders, published without any link to who asked.
CREATE TABLE "bid_answers_published" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "published_by" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_answers_published_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bid_answers_published_org_deal_idx" ON "bid_answers_published"("organization_id", "deal_id", "published_at");
ALTER TABLE "bid_answers_published" ADD CONSTRAINT "bid_answers_published_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. A bidder's membership names their bid; invitations carry it.
ALTER TABLE deal_memberships ADD COLUMN bid_id uuid;
ALTER TABLE deal_memberships
  ADD CONSTRAINT deal_memberships_bid_check CHECK ((role = 'BIDDER') = (bid_id IS NOT NULL)),
  ADD CONSTRAINT deal_memberships_bid_fkey FOREIGN KEY (organization_id, deal_id, bid_id) REFERENCES bids (organization_id, deal_id, id) ON DELETE RESTRICT;
ALTER TABLE deal_invitations ADD COLUMN bid_id uuid;
ALTER TABLE deal_invitations
  ADD CONSTRAINT deal_invitations_bid_fkey FOREIGN KEY (organization_id, deal_id, bid_id) REFERENCES bids (organization_id, deal_id, id) ON DELETE RESTRICT;
ALTER TABLE deal_invitations DROP CONSTRAINT deal_invitations_side_check;
ALTER TABLE deal_invitations ADD CONSTRAINT deal_invitations_side_check CHECK ("side" IN ('BUYER', 'SELLER', 'ADVISOR', 'BIDDER'));
ALTER TABLE deal_invitations DROP CONSTRAINT deal_invitations_role_check;
ALTER TABLE deal_invitations ADD CONSTRAINT deal_invitations_role_check CHECK (
  ("side" = 'SELLER' AND "role" = 'TARGET_CONTRIBUTOR' AND "bid_id" IS NULL)
  OR ("side" = 'ADVISOR' AND "role" IN ('ADVISER', 'VIEWER') AND "bid_id" IS NULL)
  OR ("side" = 'BUYER' AND "role" IN ('ANALYST', 'REVIEWER', 'VIEWER') AND "bid_id" IS NULL)
  OR ("side" = 'BIDDER' AND "role" = 'BIDDER' AND "bid_id" IS NOT NULL)
);

-- 6. Side helpers. Security definer (owned by the auth role, whose policy on
--    deal_memberships reads every row) so the memberships policy can call
--    them without recursing into itself. They only ever answer about the caller.
CREATE FUNCTION app_is_own_side(target_deal uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM deal_memberships m
       WHERE m.organization_id = app_current_organization_id() AND m.deal_id = target_deal
         AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE'
         AND m.role NOT IN ('TARGET_CONTRIBUTOR', 'BIDDER')
    )
  $$;
ALTER FUNCTION app_is_own_side(uuid) OWNER TO pactlab_auth;

-- The caller's own bid on a pact (null when they are not a bidder there).
CREATE FUNCTION app_current_bid_id(target_deal uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT m.bid_id FROM deal_memberships m
     WHERE m.organization_id = app_current_organization_id() AND m.deal_id = target_deal
       AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE' AND m.role = 'BIDDER'
     LIMIT 1
  $$;
ALTER FUNCTION app_current_bid_id(uuid) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_is_own_side(uuid), app_current_bid_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_own_side(uuid), app_current_bid_id(uuid) TO pactlab_app;

-- A bidder is a counterparty like a target contributor: never the pact's own side.
CREATE OR REPLACE FUNCTION app_is_buyer_side(target_deal uuid) RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM deal_memberships m
       WHERE m.organization_id = app_current_organization_id()
         AND m.deal_id = target_deal
         AND m.user_id = app_current_user_id()
         AND m.status = 'ACTIVE'
         AND m.role NOT IN ('TARGET_CONTRIBUTOR', 'BIDDER')
    )
  $$;
CREATE OR REPLACE FUNCTION app_is_buyer_analyst() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM organization_memberships o
       WHERE o.organization_id = app_current_organization_id()
         AND o.user_id = app_current_user_id()
         AND o.status = 'ACTIVE'
         AND o.role IN ('ORG_OWNER', 'ORG_ADMIN')
    ) OR EXISTS (
      SELECT 1 FROM deal_memberships m
       WHERE m.organization_id = app_current_organization_id()
         AND m.user_id = app_current_user_id()
         AND m.status = 'ACTIVE'
         AND m.role NOT IN ('TARGET_CONTRIBUTOR', 'BIDDER')
    )
  $$;

-- 7. Bidders never see each other's people: a bidder's membership is visible
--    to the pact's own side and to colleagues on the same bid only. The users
--    policy lists "people on your pacts" through this table, so it follows.
DROP POLICY deal_memberships_select ON deal_memberships;
CREATE POLICY deal_memberships_select ON deal_memberships FOR SELECT TO pactlab_app
  USING (
    organization_id = app_current_organization_id()
    AND (
      user_id = app_current_user_id()
      OR (
        deal_id = ANY (app_current_deal_ids())
        AND (role <> 'BIDDER' OR app_is_own_side(deal_id) OR bid_id = app_current_bid_id(deal_id))
      )
    )
  );

-- 8. Accepting a bidder invitation records the bid on the membership.
CREATE OR REPLACE FUNCTION app_accept_deal_invitation(p_token_hash text, p_user uuid)
  RETURNS TABLE (organization_id uuid, deal_id uuid, invitation_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  inv deal_invitations%ROWTYPE;
  v_email text;
BEGIN
  SELECT * INTO inv FROM deal_invitations i WHERE i.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR inv.status <> 'PENDING' OR inv.expires_at <= now() THEN
    RETURN;
  END IF;
  SELECT u.email INTO v_email FROM users u WHERE u.id = p_user;
  IF v_email IS NULL OR v_email <> inv.email THEN
    RETURN;
  END IF;
  INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role, status, bid_id)
  VALUES (uuidv7(), inv.organization_id, inv.deal_id, p_user, inv.role, 'ACTIVE', inv.bid_id)
  ON CONFLICT (organization_id, deal_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE', bid_id = EXCLUDED.bid_id;
  UPDATE deal_invitations SET status = 'ACCEPTED', accepted_by = p_user, accepted_at = now() WHERE id = inv.id;
  RETURN QUERY SELECT inv.organization_id, inv.deal_id, inv.id;
END
$$;
ALTER FUNCTION app_accept_deal_invitation(text, uuid) OWNER TO pactlab_auth;
GRANT SELECT (bid_id) ON deal_invitations TO pactlab_auth;

-- 9. Policies for the new tables.
GRANT SELECT, INSERT, UPDATE ON sale_processes, bids, bid_questions, bid_answers_published TO pactlab_app;
GRANT SELECT, INSERT ON bid_offers TO pactlab_app;
ALTER TABLE sale_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_processes FORCE ROW LEVEL SECURITY;
ALTER TABLE bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids FORCE ROW LEVEL SECURITY;
ALTER TABLE bid_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_offers FORCE ROW LEVEL SECURITY;
ALTER TABLE bid_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_questions FORCE ROW LEVEL SECURITY;
ALTER TABLE bid_answers_published ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_answers_published FORCE ROW LEVEL SECURITY;

-- The process: the seller's side runs it; bidders read it (deadline, round, shared view).
CREATE POLICY sale_processes_own_side ON sale_processes FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id));
CREATE POLICY sale_processes_bidder_read ON sale_processes FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_current_bid_id(deal_id) IS NOT NULL);

-- Bids: the seller's side sees all; a bidder sees only their own.
CREATE POLICY bids_own_side ON bids FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id));
CREATE POLICY bids_bidder_read ON bids FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND id = app_current_bid_id(deal_id));
-- A bidder may only accept the NDA, offer or pass on their own bid — never shortlist, decline or win.
CREATE POLICY bids_bidder_update ON bids FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND id = app_current_bid_id(deal_id) AND status IN ('INVITED', 'ACTIVE', 'OFFERED', 'SHORTLISTED'))
  WITH CHECK (organization_id = app_current_organization_id() AND id = app_current_bid_id(deal_id) AND status IN ('ACTIVE', 'OFFERED', 'PASSED', 'SHORTLISTED'));

-- Offers: written only by the bidder, read by the bidder and the seller's side. Never changed: a revision is a new version.
CREATE POLICY bid_offers_own_side_read ON bid_offers FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id));
CREATE POLICY bid_offers_bidder_read ON bid_offers FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND bid_id = app_current_bid_id(deal_id));
CREATE POLICY bid_offers_bidder_insert ON bid_offers FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND bid_id = app_current_bid_id(deal_id) AND submitted_by = app_current_user_id());

-- Questions: asked by a bidder about their own bid; answered by the seller's side.
CREATE POLICY bid_questions_own_side ON bid_questions FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id));
CREATE POLICY bid_questions_bidder_read ON bid_questions FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND bid_id = app_current_bid_id(deal_id));
CREATE POLICY bid_questions_bidder_insert ON bid_questions FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND bid_id = app_current_bid_id(deal_id) AND asked_by = app_current_user_id() AND answer IS NULL);

-- Published answers carry no bidder identity: every bidder on the pact reads them.
CREATE POLICY bid_answers_published_own_side ON bid_answers_published FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id));
CREATE POLICY bid_answers_published_bidder_read ON bid_answers_published FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_current_bid_id(deal_id) IS NOT NULL);

