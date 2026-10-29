-- T-091: the regulatory inputs that are not imports — certainty terms, the
-- remedy buyer, regulator feedback, package revisions and pledges. Each entry
-- cites the document page it comes from. Append-only (a correction is a new
-- entry; the latest TERMS and BUYER win). Buyer-side analysis.
-- Expand only. Rollback: drop the table.
CREATE TABLE "regulatory_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "citation" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regulatory_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "regulatory_entries_kind_check" CHECK ("kind" IN ('TERMS', 'BUYER', 'FEEDBACK', 'REVISION', 'COMMITMENT'))
);
CREATE INDEX "regulatory_entries_org_deal_idx" ON "regulatory_entries"("organization_id", "deal_id", "kind", "created_at");
ALTER TABLE "regulatory_entries" ADD CONSTRAINT "regulatory_entries_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT ON regulatory_entries TO pactlab_app;
ALTER TABLE regulatory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY regulatory_entries_buyer_side ON regulatory_entries FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id) AND created_by = app_current_user_id());
