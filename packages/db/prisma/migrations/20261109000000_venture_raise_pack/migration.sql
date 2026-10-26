-- T-083 Venture Raise pack. Expand only.
ALTER TYPE "company_type" ADD VALUE IF NOT EXISTS 'VENTURE_RAISE';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'VENTURE_CAP_TABLE';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'VENTURE_FINANCIALS';

-- Claims a pack rule records (a deck metric checked against billing).
ALTER TABLE "deal_claims" DROP CONSTRAINT "deal_claims_origin_check";
ALTER TABLE "deal_claims" ADD CONSTRAINT "deal_claims_origin_check" CHECK ("origin" IN ('SCREENING_RED_FLAG', 'MANUAL', 'PACK_RULE'));

CREATE TABLE "venture_raise_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "round_type" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "target_pre_money" DECIMAL(24,4) NOT NULL,
    "raise_amount" DECIMAL(24,4) NOT NULL,
    "pool_target_pct" DECIMAL(9,6) NOT NULL,
    "sector" "company_type",
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "venture_raise_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "venture_raise_settings_round_check" CHECK ("round_type" IN ('PRE_SEED', 'SEED_SAFE', 'SEED_NOTE', 'SEED_PRICED', 'SERIES_A')),
    CONSTRAINT "venture_raise_settings_amounts_check" CHECK ("target_pre_money" > 0 AND "raise_amount" > 0),
    CONSTRAINT "venture_raise_settings_pool_check" CHECK ("pool_target_pct" >= 0 AND "pool_target_pct" < 1)
);
CREATE UNIQUE INDEX "venture_raise_settings_organization_id_deal_id_key" ON "venture_raise_settings"("organization_id", "deal_id");
ALTER TABLE "venture_raise_settings" ADD CONSTRAINT "venture_raise_settings_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "venture_offers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "investor_name" TEXT NOT NULL,
    "counterparty_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROSPECT',
    "pre_money" DECIMAL(24,4),
    "amount" DECIMAL(24,4),
    "pool_target_pct" DECIMAL(9,6),
    "liquidation_multiple" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "participating" BOOLEAN NOT NULL DEFAULT false,
    "investor_board_seats" INTEGER,
    "pro_rata" BOOLEAN NOT NULL DEFAULT false,
    "mfn" BOOLEAN NOT NULL DEFAULT false,
    "received_on" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "venture_offers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "venture_offers_counterparty_check" CHECK ("counterparty_type" IN ('ANGEL', 'INCUBATOR', 'VC')),
    CONSTRAINT "venture_offers_status_check" CHECK ("status" IN ('PROSPECT', 'TERM_SHEET', 'DECLINED', 'SIGNED')),
    CONSTRAINT "venture_offers_name_check" CHECK (length("investor_name") BETWEEN 1 AND 200),
    CONSTRAINT "venture_offers_amounts_check" CHECK (("pre_money" IS NULL OR "pre_money" > 0) AND ("amount" IS NULL OR "amount" > 0)),
    CONSTRAINT "venture_offers_pool_check" CHECK ("pool_target_pct" IS NULL OR ("pool_target_pct" >= 0 AND "pool_target_pct" < 1)),
    CONSTRAINT "venture_offers_terms_check" CHECK ("liquidation_multiple" >= 0 AND ("investor_board_seats" IS NULL OR "investor_board_seats" BETWEEN 0 AND 20))
);
CREATE UNIQUE INDEX "venture_offers_organization_id_deal_id_id_key" ON "venture_offers"("organization_id", "deal_id", "id");
CREATE INDEX "venture_offers_organization_id_deal_id_created_at_idx" ON "venture_offers"("organization_id", "deal_id", "created_at");
ALTER TABLE "venture_offers" ADD CONSTRAINT "venture_offers_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Founder-side analysis: the founder's team only; target contributors never see the round or the bids.
GRANT SELECT, INSERT, UPDATE ON venture_raise_settings, venture_offers TO pactlab_app;
ALTER TABLE venture_raise_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_raise_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE venture_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_offers FORCE ROW LEVEL SECURITY;
CREATE POLICY venture_raise_settings_buyer_side ON venture_raise_settings FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY venture_offers_buyer_side ON venture_offers FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
