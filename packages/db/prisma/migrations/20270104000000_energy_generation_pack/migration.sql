-- T-142 Energy generation & rights pack (ADR 0043). Expand only.
-- A buyer acquires power plants and oil & gas mineral, royalty and working interests. The plant and
-- interest registers, lease schedule, production history and the seller's liability schedule arrive
-- as CSV import targets (ADR 0010). One table holds the entries read from reserve reports and
-- environmental reports and permits (AI-proposed, person-confirmed, each with its exact quote and
-- page): the buyer's own side (RLS app_is_buyer_side); the seller, a target contributor, never sees it.
-- Rollback: drop the table; the enum values stay (unused) as enum values cannot be dropped.
ALTER TYPE "company_type" ADD VALUE IF NOT EXISTS 'ENERGY_GENERATION';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'ENERGY_PLANTS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'ENERGY_INTERESTS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'ENERGY_LEASES';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'ENERGY_PRODUCTION';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'ENERGY_LIABILITIES';

CREATE TABLE "energy_register_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "asset_ref" TEXT,
    "detail" TEXT,
    "value" DECIMAL(24,6) NOT NULL,
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
    CONSTRAINT "energy_register_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "energy_register_items_kind_check" CHECK ("kind" IN ('RESERVES', 'RESERVE_VALUE', 'DECLINE_ASSUMPTION', 'LIABILITY_ESTIMATE')),
    CONSTRAINT "energy_register_items_status_check" CHECK ("status" IN ('PROPOSED', 'CONFIRMED', 'REJECTED')),
    CONSTRAINT "energy_register_items_origin_check" CHECK ("origin" IN ('AI', 'PERSON') AND (("origin" = 'AI') = ("ai_run_id" IS NOT NULL))),
    CONSTRAINT "energy_register_items_detail_check" CHECK ((("kind" = 'DECLINE_ASSUMPTION') = ("detail" IS NULL)) AND ("detail" IS NULL OR "detail" IN ('PDP', 'PDNP', 'PUD', 'remediation', 'ccr', 'reclamation', 'aro'))),
    CONSTRAINT "energy_register_items_asset_check" CHECK ("asset_ref" IS NULL OR length("asset_ref") BETWEEN 1 AND 200),
    CONSTRAINT "energy_register_items_value_check" CHECK ("value" >= 0),
    CONSTRAINT "energy_register_items_decided_check" CHECK (("status" = 'PROPOSED') = ("decided_by" IS NULL) AND ("decided_by" IS NULL) = ("decided_at" IS NULL))
);
CREATE UNIQUE INDEX "energy_register_items_organization_id_deal_id_id_key" ON "energy_register_items"("organization_id", "deal_id", "id");
CREATE INDEX "energy_register_items_org_deal_idx" ON "energy_register_items"("organization_id", "deal_id", "status", "created_at");
ALTER TABLE "energy_register_items" ADD CONSTRAINT "energy_register_items_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "energy_register_items" ADD CONSTRAINT "energy_register_items_document_fkey" FOREIGN KEY ("organization_id", "deal_id", "document_id") REFERENCES "documents"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The buyer's own side only; the seller (a target contributor) never sees the buyer's register work.
GRANT SELECT, INSERT, UPDATE ON energy_register_items TO pactlab_app;
ALTER TABLE energy_register_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE energy_register_items FORCE ROW LEVEL SECURITY;
CREATE POLICY energy_register_items_buyer_side ON energy_register_items FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
