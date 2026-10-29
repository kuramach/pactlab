-- T-091 Part 2: candidate remedy packages built by the analyst, compared side
-- by side with the imported revisions. A scenario stores its explicit site
-- list (resolved when built), so it never shifts when the footprint is
-- re-imported. Append-only: a changed scenario is a new one. Buyer-side
-- analysis, same isolation as regulatory_entries.
-- Expand only. Rollback: drop the table.
CREATE TABLE "regulatory_scenarios" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_revision" INTEGER,
    "remedy_buyer" TEXT NOT NULL,
    "site_ids" JSONB NOT NULL,
    "distribution_centers" JSONB NOT NULL,
    "systems_transferred" JSONB NOT NULL,
    "recipe" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regulatory_scenarios_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "regulatory_scenarios_name_check" CHECK (char_length("name") BETWEEN 1 AND 120),
    CONSTRAINT "regulatory_scenarios_sites_check" CHECK (jsonb_typeof("site_ids") = 'array')
);
CREATE INDEX "regulatory_scenarios_org_deal_idx" ON "regulatory_scenarios"("organization_id", "deal_id", "created_at");
ALTER TABLE "regulatory_scenarios" ADD CONSTRAINT "regulatory_scenarios_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT ON regulatory_scenarios TO pactlab_app;
ALTER TABLE regulatory_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_scenarios FORCE ROW LEVEL SECURITY;
CREATE POLICY regulatory_scenarios_buyer_side ON regulatory_scenarios FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id) AND created_by = app_current_user_id());
