-- Deal parties: the buying and selling entities of a Pact. Expand-only; no
-- existing object changes. Deals created before this migration simply have
-- no parties until someone describes them.

-- CreateEnum
CREATE TYPE "party_role" AS ENUM ('BUYER', 'SELLER');

-- CreateEnum
CREATE TYPE "company_ownership" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "company_type" AS ENUM ('SOFTWARE_SAAS', 'FINTECH', 'HEALTHCARE', 'TELECOM_MEDIA', 'PROFESSIONAL_SERVICES', 'PHARMA_BIOTECH', 'ECOMMERCE_DTC', 'OTHER');

-- CreateTable
CREATE TABLE "deal_parties" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "role" "party_role" NOT NULL,
    "name" TEXT NOT NULL,
    "ownership" "company_ownership" NOT NULL,
    "ticker" TEXT,
    "exchange" TEXT,
    "website" TEXT,
    "company_type" "company_type",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deal_parties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deal_parties_organization_id_deal_id_role_key" ON "deal_parties"("organization_id", "deal_id", "role");

-- AddForeignKey
ALTER TABLE "deal_parties" ADD CONSTRAINT "deal_parties_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_parties" ADD CONSTRAINT "deal_parties_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity. A public company is named by its ticker; a private one has none.
-- The seller always says what kind of company it is.
-- ---------------------------------------------------------------------------
ALTER TABLE deal_parties ADD CONSTRAINT deal_parties_name
  CHECK (length(btrim(name)) > 0);
ALTER TABLE deal_parties ADD CONSTRAINT deal_parties_listing
  CHECK (
    (ownership = 'PUBLIC' AND ticker IS NOT NULL AND length(btrim(ticker)) > 0)
    OR (ownership = 'PRIVATE' AND ticker IS NULL AND exchange IS NULL)
  );
ALTER TABLE deal_parties ADD CONSTRAINT deal_parties_seller_company_type
  CHECK (role = 'BUYER' OR company_type IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Privileges. Parties are described and corrected, never deleted.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON deal_parties TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Row-level security. Both sides of a deal know who is buying whom, so
-- target contributors may read parties; only the buyer side writes them.
-- ---------------------------------------------------------------------------
ALTER TABLE deal_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_parties FORCE ROW LEVEL SECURITY;

CREATE POLICY deal_parties_select ON deal_parties FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
CREATE POLICY deal_parties_insert ON deal_parties FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY deal_parties_update ON deal_parties FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
