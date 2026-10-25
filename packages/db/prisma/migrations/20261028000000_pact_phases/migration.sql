-- T-071: the three phases of a pact. Expand only: three new buyer-side
-- tables. The stage enum and the stage patch are unchanged; the phase is
-- derived from the stage in the domain layer.

-- Pre-Diligence: one screening record per deal. Directional only: it never
-- creates findings or touches valuation.
CREATE TABLE "screening_reviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "intake_notes" TEXT,
    "headline_revenue" NUMERIC(24, 4),
    "headline_currency" CHAR(3),
    "value_low" NUMERIC(24, 4),
    "value_high" NUMERIC(24, 4),
    "red_flags" JSONB NOT NULL DEFAULT '[]',
    "verdict" TEXT,
    "rationale" TEXT,
    "gaps" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "screening_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "screening_reviews_verdict_check" CHECK ("verdict" IS NULL OR "verdict" IN ('GO', 'NO_GO', 'NEEDS_MORE')),
    CONSTRAINT "screening_reviews_range_check" CHECK ("value_low" IS NULL OR "value_high" IS NULL OR "value_low" <= "value_high"),
    CONSTRAINT "screening_reviews_red_flags_check" CHECK (jsonb_typeof("red_flags") = 'array')
);
CREATE UNIQUE INDEX "screening_reviews_organization_id_deal_id_key" ON "screening_reviews"("organization_id", "deal_id");
ALTER TABLE "screening_reviews" ADD CONSTRAINT "screening_reviews_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Diligence: said vs observed. Links are references (ids), never copies.
CREATE TABLE "deal_claims" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "statement" TEXT NOT NULL,
    "source" TEXT,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "rationale" TEXT,
    "evidence_item_ids" UUID[] NOT NULL DEFAULT '{}',
    "finding_ids" UUID[] NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deal_claims_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deal_claims_status_check" CHECK ("status" IN ('UNVERIFIED', 'VERIFIED', 'CONTRADICTED')),
    CONSTRAINT "deal_claims_origin_check" CHECK ("origin" IN ('SCREENING_RED_FLAG', 'MANUAL')),
    CONSTRAINT "deal_claims_statement_check" CHECK (length("statement") BETWEEN 3 AND 1000)
);
CREATE UNIQUE INDEX "deal_claims_organization_id_deal_id_id_key" ON "deal_claims"("organization_id", "deal_id", "id");
CREATE INDEX "deal_claims_organization_id_deal_id_created_at_idx" ON "deal_claims"("organization_id", "deal_id", "created_at");
ALTER TABLE "deal_claims" ADD CONSTRAINT "deal_claims_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Post-Close: registers generated from diligence output by reference.
CREATE TABLE "post_close_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "owner_user_id" UUID,
    "due_date" DATE,
    "cadence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_close_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "post_close_items_kind_check" CHECK ("kind" IN ('ASSET', 'ACTION', 'WATCH')),
    CONSTRAINT "post_close_items_source_check" CHECK ("source_type" IN ('FINDING')),
    CONSTRAINT "post_close_items_status_check" CHECK ("status" IN ('OPEN', 'DONE', 'LAPSED')),
    CONSTRAINT "post_close_items_cadence_check" CHECK ("cadence" IS NULL OR "cadence" IN ('MONTHLY', 'QUARTERLY', 'ANNUAL'))
);
CREATE UNIQUE INDEX "post_close_items_source_key" ON "post_close_items"("organization_id", "deal_id", "kind", "source_type", "source_id");
CREATE INDEX "post_close_items_organization_id_deal_id_idx" ON "post_close_items"("organization_id", "deal_id");
ALTER TABLE "post_close_items" ADD CONSTRAINT "post_close_items_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON screening_reviews, deal_claims, post_close_items TO pactlab_app;
ALTER TABLE screening_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE screening_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE deal_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE post_close_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_close_items FORCE ROW LEVEL SECURITY;
-- Buyer-side analysis: target contributors never see screening, claims or post-close registers.
CREATE POLICY screening_reviews_buyer_side ON screening_reviews FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY deal_claims_buyer_side ON deal_claims FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY post_close_items_buyer_side ON post_close_items FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
