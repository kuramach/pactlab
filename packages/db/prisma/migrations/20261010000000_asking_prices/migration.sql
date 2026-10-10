-- Asking prices: the seller's price for a deal, versioned as it is revised.
-- Expand-only; no existing object changes.

-- CreateEnum
CREATE TYPE "asking_basis" AS ENUM ('ENTERPRISE_VALUE', 'EQUITY_VALUE');

-- CreateEnum
CREATE TYPE "asking_source" AS ENUM ('TEASER', 'MANAGEMENT', 'LETTER_OF_INTENT', 'BANKER', 'OTHER');

-- CreateTable
CREATE TABLE "asking_prices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "basis" "asking_basis" NOT NULL,
    "source" "asking_source" NOT NULL,
    "quoted_on" DATE,
    "earn_out_amount" DECIMAL(24,4),
    "note" TEXT,
    "recorded_by" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asking_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asking_prices_organization_id_deal_id_version_key" ON "asking_prices"("organization_id", "deal_id", "version");

-- AddForeignKey
ALTER TABLE "asking_prices" ADD CONSTRAINT "asking_prices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asking_prices" ADD CONSTRAINT "asking_prices_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity. A positive price in an ISO currency; any earn-out is part of it.
-- ---------------------------------------------------------------------------
ALTER TABLE asking_prices ADD CONSTRAINT asking_prices_values
  CHECK (
    version >= 1
    AND amount > 0
    AND currency ~ '^[A-Z]{3}$'
    AND (earn_out_amount IS NULL OR (earn_out_amount >= 0 AND earn_out_amount <= amount))
    AND (note IS NULL OR length(note) <= 500)
  );

-- ---------------------------------------------------------------------------
-- Privileges. Append-only: revisions are new versions; nothing is changed or deleted.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON asking_prices TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Row-level security. Negotiation terms are buyer-side analysis: target
-- contributors never see them. Writers record themselves.
-- ---------------------------------------------------------------------------
ALTER TABLE asking_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE asking_prices FORCE ROW LEVEL SECURITY;

CREATE POLICY asking_prices_select ON asking_prices FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY asking_prices_insert ON asking_prices FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
    AND recorded_by = app_current_user_id()
  );
