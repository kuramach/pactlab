-- T-141 Startup equity SPV (ADR 0043). Expand only.
-- One pact, three parties, two walled directions: the organizer (the pact's own side) diligences the
-- startup's round, and pools investors into one vehicle. Investors are seated as guests with the new
-- deal role INVESTOR, one seat each (the BIDDER/bid_id pattern of ADR 0015): an investor reads only
-- their own seat and the organizer's published, frozen investor view, never another investor, and
-- nothing of the pact's evidence. The startup (a target contributor) never sees the investor list.
-- Rollback: drop investor_view_versions, pact_investors, spv_vehicles, the investor_id columns and the
-- new functions and policies; restore app_is_own_side, app_is_buyer_side, app_is_buyer_analyst,
-- deal_memberships_select, the deal_invitations checks and app_accept_deal_invitation from
-- 20261114000100_seller_led_sale.

-- 1. The vehicle: one per pact, the organizer's own side. Exit paths are the organizer's stated
--    assumptions (multiples of the round's post-money); null until stated, never defaulted.
CREATE TABLE "spv_vehicles" (
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "vehicle_name" TEXT NOT NULL,
    "downside_multiple" DECIMAL(10,4),
    "base_multiple" DECIMAL(10,4),
    "upside_multiple" DECIMAL(10,4),
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "spv_vehicles_pkey" PRIMARY KEY ("organization_id", "deal_id"),
    CONSTRAINT "spv_vehicles_name_check" CHECK (length(btrim("vehicle_name")) BETWEEN 1 AND 200),
    CONSTRAINT "spv_vehicles_multiples_check" CHECK (
      ("downside_multiple" IS NULL OR "downside_multiple" BETWEEN 0 AND 1000)
      AND ("base_multiple" IS NULL OR "base_multiple" BETWEEN 0 AND 1000)
      AND ("upside_multiple" IS NULL OR "upside_multiple" BETWEEN 0 AND 1000))
);
ALTER TABLE "spv_vehicles" ADD CONSTRAINT "spv_vehicles_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Investor seats: one per investor (a firm or a person), with the commitment and the tracked
--    accreditation status. Pactlab verifies nothing: a specialist's link and an evidence pointer.
--    The reference (e.g. INV-03) is how checks and side letters name an investor.
CREATE TABLE "pact_investors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "commitment" DECIMAL(24,4),
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "accreditation_status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "accreditation_provider" TEXT,
    "accreditation_url" TEXT,
    "accreditation_evidence" TEXT,
    "accreditation_updated_at" TIMESTAMPTZ(3),
    "accreditation_updated_by" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pact_investors_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pact_investors_label_check" CHECK (length(btrim("label")) BETWEEN 1 AND 200),
    CONSTRAINT "pact_investors_reference_check" CHECK ("reference" ~ '^[A-Z0-9][A-Z0-9-]{0,30}$'),
    CONSTRAINT "pact_investors_commitment_check" CHECK ("commitment" IS NULL OR "commitment" > 0),
    CONSTRAINT "pact_investors_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "pact_investors_status_check" CHECK ("status" IN ('ACTIVE', 'WITHDRAWN')),
    CONSTRAINT "pact_investors_accreditation_check" CHECK ("accreditation_status" IN ('NOT_STARTED', 'SELF_CERTIFIED', 'PENDING_VERIFICATION', 'THIRD_PARTY_VERIFIED', 'NOT_ACCREDITED')),
    CONSTRAINT "pact_investors_provider_check" CHECK ("accreditation_provider" IS NULL OR length("accreditation_provider") BETWEEN 1 AND 200),
    CONSTRAINT "pact_investors_url_check" CHECK ("accreditation_url" IS NULL OR ("accreditation_url" LIKE 'https://%' AND length("accreditation_url") <= 2000)),
    CONSTRAINT "pact_investors_evidence_check" CHECK ("accreditation_evidence" IS NULL OR length("accreditation_evidence") BETWEEN 1 AND 500)
);
CREATE UNIQUE INDEX "pact_investors_org_deal_id_key" ON "pact_investors"("organization_id", "deal_id", "id");
CREATE UNIQUE INDEX "pact_investors_reference_key" ON "pact_investors"("organization_id", "deal_id", "reference");
CREATE INDEX "pact_investors_org_deal_created_idx" ON "pact_investors"("organization_id", "deal_id", "created_at", "id");
ALTER TABLE "pact_investors" ADD CONSTRAINT "pact_investors_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. An investor's membership names their seat; invitations carry it.
ALTER TABLE deal_memberships ADD COLUMN investor_id uuid;
ALTER TABLE deal_memberships
  ADD CONSTRAINT deal_memberships_investor_check CHECK ((role::text = 'INVESTOR') = (investor_id IS NOT NULL)),
  ADD CONSTRAINT deal_memberships_investor_fkey FOREIGN KEY (organization_id, deal_id, investor_id) REFERENCES pact_investors (organization_id, deal_id, id) ON DELETE RESTRICT;
ALTER TABLE deal_invitations ADD COLUMN investor_id uuid;
ALTER TABLE deal_invitations
  ADD CONSTRAINT deal_invitations_investor_fkey FOREIGN KEY (organization_id, deal_id, investor_id) REFERENCES pact_investors (organization_id, deal_id, id) ON DELETE RESTRICT;
ALTER TABLE deal_invitations DROP CONSTRAINT deal_invitations_side_check;
ALTER TABLE deal_invitations ADD CONSTRAINT deal_invitations_side_check CHECK ("side" IN ('BUYER', 'SELLER', 'ADVISOR', 'BIDDER', 'INVESTOR'));
ALTER TABLE deal_invitations DROP CONSTRAINT deal_invitations_role_check;
ALTER TABLE deal_invitations ADD CONSTRAINT deal_invitations_role_check CHECK (
  ("side" = 'SELLER' AND "role"::text = 'TARGET_CONTRIBUTOR' AND "bid_id" IS NULL AND "investor_id" IS NULL)
  OR ("side" = 'ADVISOR' AND "role"::text IN ('ADVISER', 'VIEWER') AND "bid_id" IS NULL AND "investor_id" IS NULL)
  OR ("side" = 'BUYER' AND "role"::text IN ('ANALYST', 'REVIEWER', 'VIEWER') AND "bid_id" IS NULL AND "investor_id" IS NULL)
  OR ("side" = 'BIDDER' AND "role"::text = 'BIDDER' AND "bid_id" IS NOT NULL AND "investor_id" IS NULL)
  OR ("side" = 'INVESTOR' AND "role"::text = 'INVESTOR' AND "investor_id" IS NOT NULL AND "bid_id" IS NULL)
);
GRANT SELECT (investor_id) ON deal_invitations TO pactlab_auth;

-- 4. Side helpers. Security definer (owned by the auth role) so the memberships policy can call them
--    without recursing; they only ever answer about the caller.
-- The caller's own seat on a pact (null when they are not an investor there).
CREATE FUNCTION app_current_investor_id(target_deal uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT m.investor_id FROM deal_memberships m
     WHERE m.organization_id = app_current_organization_id() AND m.deal_id = target_deal
       AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE' AND m.role::text = 'INVESTOR'
     LIMIT 1
  $$;
-- The pacts where the caller is seated as an investor (evaluated once per query, not per row).
CREATE FUNCTION app_investor_deal_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT coalesce(array_agg(m.deal_id), '{}'::uuid[]) FROM deal_memberships m
     WHERE m.organization_id = app_current_organization_id()
       AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE' AND m.role::text = 'INVESTOR'
  $$;
ALTER FUNCTION app_current_investor_id(uuid) OWNER TO pactlab_auth;
ALTER FUNCTION app_investor_deal_ids() OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_current_investor_id(uuid), app_investor_deal_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_investor_id(uuid), app_investor_deal_ids() TO pactlab_app;

-- An investor is a counterparty, like a target contributor or a bidder: never the pact's own side.
CREATE OR REPLACE FUNCTION app_is_own_side(target_deal uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM deal_memberships m
       WHERE m.organization_id = app_current_organization_id() AND m.deal_id = target_deal
         AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE'
         AND m.role::text NOT IN ('TARGET_CONTRIBUTOR', 'BIDDER', 'INVESTOR')
    )
  $$;
CREATE OR REPLACE FUNCTION app_is_buyer_side(target_deal uuid) RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM deal_memberships m
       WHERE m.organization_id = app_current_organization_id()
         AND m.deal_id = target_deal
         AND m.user_id = app_current_user_id()
         AND m.status = 'ACTIVE'
         AND m.role::text NOT IN ('TARGET_CONTRIBUTOR', 'BIDDER', 'INVESTOR')
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
         AND m.role::text NOT IN ('TARGET_CONTRIBUTOR', 'BIDDER', 'INVESTOR')
    )
  $$;

-- 5. Investors never see each other, and the startup never sees the investor list: an investor's
--    membership is visible to the pact's own side and to colleagues on the same seat only. The users
--    policy lists "people on your pacts" through this table, so names follow.
DROP POLICY deal_memberships_select ON deal_memberships;
CREATE POLICY deal_memberships_select ON deal_memberships FOR SELECT TO pactlab_app
  USING (
    organization_id = app_current_organization_id()
    AND (
      user_id = app_current_user_id()
      OR (
        deal_id = ANY (app_current_deal_ids())
        AND (role <> 'BIDDER' OR app_is_own_side(deal_id) OR bid_id = app_current_bid_id(deal_id))
        AND (investor_id IS NULL OR app_is_own_side(deal_id) OR investor_id = app_current_investor_id(deal_id))
      )
    )
  );

-- 6. Accepting an investor invitation records the seat on the membership.
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
  INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role, status, bid_id, investor_id)
  VALUES (uuidv7(), inv.organization_id, inv.deal_id, p_user, inv.role, 'ACTIVE', inv.bid_id, inv.investor_id)
  ON CONFLICT (organization_id, deal_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE', bid_id = EXCLUDED.bid_id, investor_id = EXCLUDED.investor_id;
  UPDATE deal_invitations SET status = 'ACCEPTED', accepted_by = p_user, accepted_at = now() WHERE id = inv.id;
  RETURN QUERY SELECT inv.organization_id, inv.deal_id, inv.id;
END
$$;

-- 7. The published investor view: a versioned, frozen snapshot built from an allow-list. The CHECK is
--    the data-layer allow-list: no top-level section outside it can be stored. Never changed or
--    deleted once written; a correction is a new version.
CREATE TABLE "investor_view_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "published_by" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "investor_view_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "investor_view_versions_version_check" CHECK ("version" >= 1),
    CONSTRAINT "investor_view_versions_sections" CHECK (jsonb_typeof("content") = 'object' AND ("content" - ARRAY['meta', 'claims', 'capTable', 'economics', 'scenarios']) = '{}'::jsonb),
    CONSTRAINT "investor_view_versions_sha_check" CHECK ("content_sha256" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "investor_view_versions_deal_version_key" ON "investor_view_versions"("organization_id", "deal_id", "version");
ALTER TABLE "investor_view_versions" ADD CONSTRAINT "investor_view_versions_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE OR REPLACE FUNCTION investor_view_versions_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a published investor view is final; publish a new version instead' USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER investor_view_versions_frozen BEFORE UPDATE OR DELETE ON investor_view_versions FOR EACH ROW EXECUTE FUNCTION investor_view_versions_frozen();

-- 8. Policies. The vehicle is the organizer's own side; seats are the own side's, and an investor
--    reads only their own; published views are read by the own side and the pact's investors.
GRANT SELECT, INSERT, UPDATE ON spv_vehicles, pact_investors TO pactlab_app;
GRANT SELECT, INSERT ON investor_view_versions TO pactlab_app;
ALTER TABLE spv_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE spv_vehicles FORCE ROW LEVEL SECURITY;
ALTER TABLE pact_investors ENABLE ROW LEVEL SECURITY;
ALTER TABLE pact_investors FORCE ROW LEVEL SECURITY;
ALTER TABLE investor_view_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_view_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY spv_vehicles_own_side ON spv_vehicles FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id));
CREATE POLICY pact_investors_own_side ON pact_investors FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id));
CREATE POLICY pact_investors_investor_read ON pact_investors FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND id = app_current_investor_id(deal_id));
CREATE POLICY investor_view_versions_own_side ON investor_view_versions FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id) AND published_by = app_current_user_id());
CREATE POLICY investor_view_versions_investor_read ON investor_view_versions FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_current_investor_id(deal_id) IS NOT NULL);

-- 9. The wall around the pact's material: an investor reads none of its evidence, documents, pages,
--    sources, uploads or import formats — not even what the startup shared with the organizer. A
--    restrictive policy, so it narrows every existing policy rather than replacing any.
CREATE POLICY connections_no_investors ON connections AS RESTRICTIVE FOR ALL TO pactlab_app USING (NOT (deal_id = ANY (app_investor_deal_ids())));
CREATE POLICY evidence_items_no_investors ON evidence_items AS RESTRICTIVE FOR ALL TO pactlab_app USING (NOT (deal_id = ANY (app_investor_deal_ids())));
CREATE POLICY documents_no_investors ON documents AS RESTRICTIVE FOR ALL TO pactlab_app USING (NOT (deal_id = ANY (app_investor_deal_ids())));
CREATE POLICY document_pages_no_investors ON document_pages AS RESTRICTIVE FOR ALL TO pactlab_app USING (NOT (deal_id = ANY (app_investor_deal_ids())));
CREATE POLICY document_sources_no_investors ON document_sources AS RESTRICTIVE FOR ALL TO pactlab_app USING (NOT (deal_id = ANY (app_investor_deal_ids())));
CREATE POLICY source_uploads_no_investors ON source_uploads AS RESTRICTIVE FOR ALL TO pactlab_app USING (NOT (deal_id = ANY (app_investor_deal_ids())));
CREATE POLICY import_formats_no_investors ON import_formats AS RESTRICTIVE FOR ALL TO pactlab_app USING (NOT (deal_id = ANY (app_investor_deal_ids())));
