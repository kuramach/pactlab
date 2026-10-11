-- Balance-sheet items: cash, debt and debt-like items backed by cited documents.
-- Expand-only; no existing object changes.

-- CreateEnum
CREATE TYPE "balance_sheet_kind" AS ENUM ('CASH', 'DEBT', 'DEBT_LIKE');

-- CreateEnum
CREATE TYPE "balance_sheet_item_status" AS ENUM ('ACTIVE', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "balance_sheet_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "kind" "balance_sheet_kind" NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "as_of" DATE NOT NULL,
    "citation" JSONB NOT NULL,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "balance_sheet_item_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_sheet_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_sheet_item_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "balance_sheet_kind" NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "as_of" DATE NOT NULL,
    "citation" JSONB NOT NULL,
    "note" TEXT,
    "status" "balance_sheet_item_status" NOT NULL,
    "reason" TEXT NOT NULL,
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_sheet_item_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "balance_sheet_items_organization_id_deal_id_status_idx" ON "balance_sheet_items"("organization_id", "deal_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "balance_sheet_items_organization_id_deal_id_id_key" ON "balance_sheet_items"("organization_id", "deal_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "balance_sheet_item_versions_organization_id_deal_id_item_id_key" ON "balance_sheet_item_versions"("organization_id", "deal_id", "item_id", "version");

-- AddForeignKey
ALTER TABLE "balance_sheet_items" ADD CONSTRAINT "balance_sheet_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_sheet_items" ADD CONSTRAINT "balance_sheet_items_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_sheet_item_versions" ADD CONSTRAINT "balance_sheet_item_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_sheet_item_versions" ADD CONSTRAINT "balance_sheet_item_versions_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_sheet_item_versions" ADD CONSTRAINT "balance_sheet_item_versions_organization_id_deal_id_item_i_fkey" FOREIGN KEY ("organization_id", "deal_id", "item_id") REFERENCES "balance_sheet_items"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Integrity. Non-negative amounts in an ISO currency; each category belongs
-- to one kind; every item cites a document page with an exact quote.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_balance_sheet_category_ok(k balance_sheet_kind, c text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT CASE k
      WHEN 'CASH' THEN c IN ('CASH')
      WHEN 'DEBT' THEN c IN ('TERM_LOAN', 'REVOLVER', 'SHAREHOLDER_LOAN', 'CONVERTIBLE_NOTE', 'OTHER_DEBT')
      WHEN 'DEBT_LIKE' THEN c IN ('DEFERRED_REVENUE', 'UNPAID_TAX', 'ACCRUED_BONUS', 'EARN_OUT', 'LEASE',
                                  'CUSTOMER_PREPAYMENT', 'TRANSACTION_COSTS', 'OTHER_DEBT_LIKE')
    END
  $$;
GRANT EXECUTE ON FUNCTION app_balance_sheet_category_ok(balance_sheet_kind, text) TO pactlab_app;

ALTER TABLE balance_sheet_items ADD CONSTRAINT balance_sheet_items_values
  CHECK (
    amount >= 0
    AND currency ~ '^[A-Z]{3}$'
    AND version >= 1
    AND app_balance_sheet_category_ok(kind, category)
    AND length(label) BETWEEN 1 AND 200
    AND (note IS NULL OR length(note) <= 1000)
    AND jsonb_typeof(citation) = 'object'
    AND citation ? 'documentId' AND citation ? 'pageNumber' AND citation ? 'quote' AND citation ? 'quoteHash'
  );
ALTER TABLE balance_sheet_item_versions ADD CONSTRAINT balance_sheet_item_versions_values
  CHECK (
    amount >= 0
    AND version >= 1
    AND app_balance_sheet_category_ok(kind, category)
    AND length(trim(reason)) BETWEEN 3 AND 1000
  );

-- ---------------------------------------------------------------------------
-- Privileges. Items change only through revisions recorded in the history;
-- nothing is deleted. The history is append-only.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON balance_sheet_items TO pactlab_app;
GRANT UPDATE (category, label, amount, currency, as_of, citation, note, version, status, updated_by, updated_at)
  ON balance_sheet_items TO pactlab_app;
GRANT SELECT, INSERT ON balance_sheet_item_versions TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Row-level security. Valuation inputs are buyer-side analysis.
-- ---------------------------------------------------------------------------
ALTER TABLE balance_sheet_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_sheet_items FORCE ROW LEVEL SECURITY;
ALTER TABLE balance_sheet_item_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_sheet_item_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY balance_sheet_items_select ON balance_sheet_items FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY balance_sheet_items_insert ON balance_sheet_items FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
    AND created_by = app_current_user_id() AND updated_by = app_current_user_id() AND version = 1 AND status = 'ACTIVE'
  );
CREATE POLICY balance_sheet_items_update ON balance_sheet_items FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id) AND status = 'ACTIVE')
  WITH CHECK (organization_id = app_current_organization_id() AND updated_by = app_current_user_id());

CREATE POLICY balance_sheet_item_versions_select ON balance_sheet_item_versions FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY balance_sheet_item_versions_insert ON balance_sheet_item_versions FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
    AND changed_by = app_current_user_id()
  );
