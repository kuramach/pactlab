-- Negotiation anchors: comparables the deal lead cites against the ask.
-- Expand-only: a defaulted column on comparables and a new table.

-- CreateEnum
CREATE TYPE "arr_basis" AS ENUM ('ARR', 'REVENUE');

-- CreateEnum
CREATE TYPE "anchor_status" AS ENUM ('ACTIVE', 'REMOVED');

-- AlterTable
ALTER TABLE "comparables" ADD COLUMN     "arr_basis" "arr_basis" NOT NULL DEFAULT 'ARR';

-- CreateTable
CREATE TABLE "negotiation_anchors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "comparable_id" UUID NOT NULL,
    "note" TEXT,
    "status" "anchor_status" NOT NULL DEFAULT 'ACTIVE',
    "added_by" UUID NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_by" UUID,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "negotiation_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "negotiation_anchors_organization_id_deal_id_status_idx" ON "negotiation_anchors"("organization_id", "deal_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "comparables_organization_id_id_key" ON "comparables"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "negotiation_anchors" ADD CONSTRAINT "negotiation_anchors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negotiation_anchors" ADD CONSTRAINT "negotiation_anchors_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negotiation_anchors" ADD CONSTRAINT "negotiation_anchors_organization_id_comparable_id_fkey" FOREIGN KEY ("organization_id", "comparable_id") REFERENCES "comparables"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Integrity. One active anchor per comparable per deal; removal is recorded.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX negotiation_anchors_one_active
  ON negotiation_anchors (organization_id, deal_id, comparable_id) WHERE status = 'ACTIVE';
ALTER TABLE negotiation_anchors ADD CONSTRAINT negotiation_anchors_values
  CHECK (
    (note IS NULL OR length(note) <= 500)
    AND ((status = 'REMOVED') = (removed_by IS NOT NULL AND removed_at IS NOT NULL))
  );

-- ---------------------------------------------------------------------------
-- Privileges. Anchors are removed, never deleted or edited.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON negotiation_anchors TO pactlab_app;
GRANT UPDATE (status, removed_by, removed_at) ON negotiation_anchors TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Row-level security. Negotiation positions are buyer-side analysis.
-- ---------------------------------------------------------------------------
ALTER TABLE negotiation_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE negotiation_anchors FORCE ROW LEVEL SECURITY;

CREATE POLICY negotiation_anchors_select ON negotiation_anchors FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY negotiation_anchors_insert ON negotiation_anchors FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
    AND added_by = app_current_user_id() AND status = 'ACTIVE'
  );
CREATE POLICY negotiation_anchors_remove ON negotiation_anchors FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id) AND status = 'ACTIVE')
  WITH CHECK (organization_id = app_current_organization_id() AND status = 'REMOVED' AND removed_by = app_current_user_id());
