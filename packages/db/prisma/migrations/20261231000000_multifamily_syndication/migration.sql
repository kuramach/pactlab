-- T-106 Multifamily syndication pack, sponsor side (PR 1). Expand only.
-- The pact is a sponsor buying a multifamily property (the Multifamily pack, unchanged) and
-- raising the equity from accredited investors. Two tables hold the offering: its settings
-- (the base, downside and upside paths the waterfall is recomputed on) and the items read from
-- the PPM, operating agreement and investor deck (AI-proposed, person-confirmed, each with its
-- exact quote and page). Both are the sponsor's own side (RLS app_is_buyer_side): the seller,
-- a target contributor, never sees the raise.
-- Rollback: drop both tables; the enum values stay (unused) as enum values cannot be dropped.
ALTER TYPE "company_type" ADD VALUE IF NOT EXISTS 'MULTIFAMILY_SYNDICATION';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'SYNDICATION_TRACK_RECORD';

CREATE TABLE "syndication_offerings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "purchase_price" DECIMAL(24,4) NOT NULL,
    "loan_amount" DECIMAL(24,4) NOT NULL,
    "interest_rate_pct" DECIMAL(9,4) NOT NULL,
    "equity_raise" DECIMAL(24,4) NOT NULL,
    "hold_years" INTEGER NOT NULL,
    "selling_costs_pct" DECIMAL(9,4) NOT NULL,
    "noi_year1" DECIMAL(24,4),
    "downside_noi_growth_pct" DECIMAL(9,4) NOT NULL,
    "base_noi_growth_pct" DECIMAL(9,4) NOT NULL,
    "upside_noi_growth_pct" DECIMAL(9,4) NOT NULL,
    "downside_exit_cap_pct" DECIMAL(9,4) NOT NULL,
    "base_exit_cap_pct" DECIMAL(9,4) NOT NULL,
    "upside_exit_cap_pct" DECIMAL(9,4) NOT NULL,
    "exemption" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "syndication_offerings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "syndication_offerings_exemption_check" CHECK ("exemption" IN ('RULE_506B', 'RULE_506C')),
    CONSTRAINT "syndication_offerings_amounts_check" CHECK ("purchase_price" > 0 AND "equity_raise" > 0 AND "loan_amount" >= 0 AND "loan_amount" < "purchase_price" AND ("noi_year1" IS NULL OR "noi_year1" > 0)),
    CONSTRAINT "syndication_offerings_hold_check" CHECK ("hold_years" BETWEEN 1 AND 30),
    CONSTRAINT "syndication_offerings_rates_check" CHECK (
      "interest_rate_pct" >= 0 AND "interest_rate_pct" < 100 AND "selling_costs_pct" >= 0 AND "selling_costs_pct" < 100
      AND "downside_exit_cap_pct" > 0 AND "base_exit_cap_pct" > 0 AND "upside_exit_cap_pct" > 0
      AND "downside_exit_cap_pct" < 100 AND "base_exit_cap_pct" < 100 AND "upside_exit_cap_pct" < 100
      AND "downside_noi_growth_pct" > -100 AND "downside_noi_growth_pct" < 100
      AND "base_noi_growth_pct" > -100 AND "base_noi_growth_pct" < 100
      AND "upside_noi_growth_pct" > -100 AND "upside_noi_growth_pct" < 100)
);
CREATE UNIQUE INDEX "syndication_offerings_organization_id_deal_id_key" ON "syndication_offerings"("organization_id", "deal_id");
ALTER TABLE "syndication_offerings" ADD CONSTRAINT "syndication_offerings_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "syndication_offering_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "value" DECIMAL(18,6),
    "hurdle" DECIMAL(18,6),
    "citation" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "origin" TEXT NOT NULL,
    "ai_run_id" UUID,
    "decision_note" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "syndication_offering_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "syndication_offering_items_source_check" CHECK ("source" IN ('PPM', 'OPERATING_AGREEMENT', 'DECK')),
    CONSTRAINT "syndication_offering_items_kind_check" CHECK ("kind" IN (
      'ACQUISITION_FEE', 'ASSET_MANAGEMENT_FEE', 'DISPOSITION_FEE', 'OTHER_FEE', 'PREFERRED_RETURN', 'PROMOTE_TIER', 'CATCH_UP',
      'PROJECTED_IRR', 'EQUITY_MULTIPLE', 'CASH_ON_CASH', 'OCCUPANCY', 'NOI_GROWTH', 'EXIT_CAP_RATE', 'TRACK_RECORD')),
    CONSTRAINT "syndication_offering_items_status_check" CHECK ("status" IN ('PROPOSED', 'CONFIRMED', 'REJECTED')),
    CONSTRAINT "syndication_offering_items_origin_check" CHECK ("origin" IN ('AI', 'PERSON') AND (("origin" = 'AI') = ("ai_run_id" IS NOT NULL))),
    CONSTRAINT "syndication_offering_items_label_check" CHECK (("kind" IN ('OTHER_FEE', 'TRACK_RECORD')) = ("label" IS NOT NULL) AND ("label" IS NULL OR length("label") BETWEEN 1 AND 160)),
    CONSTRAINT "syndication_offering_items_hurdle_check" CHECK ("hurdle" IS NULL OR "kind" = 'PROMOTE_TIER'),
    CONSTRAINT "syndication_offering_items_decided_check" CHECK (("status" = 'PROPOSED') = ("decided_by" IS NULL) AND ("decided_by" IS NULL) = ("decided_at" IS NULL))
);
CREATE UNIQUE INDEX "syndication_offering_items_organization_id_deal_id_id_key" ON "syndication_offering_items"("organization_id", "deal_id", "id");
CREATE INDEX "syndication_offering_items_org_deal_idx" ON "syndication_offering_items"("organization_id", "deal_id", "status", "created_at");
ALTER TABLE "syndication_offering_items" ADD CONSTRAINT "syndication_offering_items_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "syndication_offering_items" ADD CONSTRAINT "syndication_offering_items_document_fkey" FOREIGN KEY ("organization_id", "deal_id", "document_id") REFERENCES "documents"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The sponsor's own side only; the seller (a target contributor) never sees the raise.
GRANT SELECT, INSERT, UPDATE ON syndication_offerings, syndication_offering_items TO pactlab_app;
ALTER TABLE syndication_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE syndication_offerings FORCE ROW LEVEL SECURITY;
ALTER TABLE syndication_offering_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE syndication_offering_items FORCE ROW LEVEL SECURITY;
CREATE POLICY syndication_offerings_buyer_side ON syndication_offerings FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY syndication_offering_items_buyer_side ON syndication_offering_items FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
