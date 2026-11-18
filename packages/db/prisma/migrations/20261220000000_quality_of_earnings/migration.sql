-- T-135: quality of earnings. One append-only table holds the cited inputs of the
-- adjusted-EBITDA schedule (reported EBITDA, normalization adjustments), the seller's
-- add-back register, and the working-capital lines behind the peg. A change is a new
-- version of the same entry_key; the latest version counts. Buyer-side analysis.
-- The working-capital peg reaches the seller only as a deal term (new lever).
-- Expand only. Rollback: drop the table, and restore term_proposals_lever_check
-- from 20261208000000_buyer_financing.
CREATE TABLE "qoe_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "entry_key" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT,
    "period_end" DATE,
    "category" TEXT,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "citation" JSONB NOT NULL,
    "rationale" TEXT,
    "verification_status" TEXT,
    "verified_amount" DECIMAL(24,4),
    "verification_citation" JSONB,
    "recurrence" TEXT,
    "inclusion" TEXT,
    "decision_reason" TEXT,
    "withdrawn" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "finding_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qoe_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "qoe_entries_kind_check" CHECK ("kind" IN ('REPORTED_EBITDA', 'ADJUSTMENT', 'ADD_BACK', 'WORKING_CAPITAL')),
    CONSTRAINT "qoe_entries_category_check" CHECK (
      CASE "kind"
        WHEN 'REPORTED_EBITDA' THEN "category" IS NULL
        WHEN 'WORKING_CAPITAL' THEN "category" IN ('RECEIVABLES', 'INVENTORY', 'PREPAID_EXPENSES', 'OTHER_CURRENT_ASSETS', 'PAYABLES', 'ACCRUED_LIABILITIES', 'DEFERRED_REVENUE', 'OTHER_CURRENT_LIABILITIES')
        ELSE "category" IN ('OWNER_COMPENSATION', 'NON_RECURRING', 'RELATED_PARTY', 'RENT_NORMALIZATION', 'PRO_FORMA_ACQUISITION', 'PRO_FORMA_LOCATION', 'PRO_FORMA_CONTRACT', 'OTHER')
      END),
    CONSTRAINT "qoe_entries_period_check" CHECK (("kind" = 'WORKING_CAPITAL') = ("period_end" IS NOT NULL) AND ("kind" = 'WORKING_CAPITAL') = ("period" IS NULL)),
    CONSTRAINT "qoe_entries_add_back_check" CHECK (
      ("kind" = 'ADD_BACK') = ("verification_status" IS NOT NULL)
      AND ("kind" = 'ADD_BACK') = ("recurrence" IS NOT NULL)
      AND ("kind" = 'ADD_BACK' OR ("inclusion" IS NULL AND "verified_amount" IS NULL AND "verification_citation" IS NULL))
      AND ("verification_status" IS NULL OR "verification_status" IN ('VERIFIED', 'PARTIALLY_VERIFIED', 'UNVERIFIED'))
      AND ("recurrence" IS NULL OR "recurrence" IN ('RECURRING', 'ONE_OFF'))
      AND (("verification_status" = 'PARTIALLY_VERIFIED') = ("verified_amount" IS NOT NULL))
      AND (("verification_status" IN ('VERIFIED', 'PARTIALLY_VERIFIED')) = ("verification_citation" IS NOT NULL))
      AND ("inclusion" IS NULL OR ("inclusion" IN ('INCLUDE', 'EXCLUDE') AND "decision_reason" IS NOT NULL))),
    CONSTRAINT "qoe_entries_version_check" CHECK ("version" >= 1)
);
CREATE UNIQUE INDEX "qoe_entries_entry_version_key" ON "qoe_entries"("organization_id", "deal_id", "entry_key", "version");
CREATE INDEX "qoe_entries_org_deal_idx" ON "qoe_entries"("organization_id", "deal_id", "kind", "created_at");
ALTER TABLE "qoe_entries" ADD CONSTRAINT "qoe_entries_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only: no UPDATE or DELETE grant; a correction is the next version.
GRANT SELECT, INSERT ON qoe_entries TO pactlab_app;
ALTER TABLE qoe_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE qoe_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY qoe_entries_buyer_side ON qoe_entries FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id) AND created_by = app_current_user_id());

-- The working-capital peg (target net working capital) as a term: answered and agreed like any other.
ALTER TABLE "term_proposals" DROP CONSTRAINT "term_proposals_lever_check",
  ADD CONSTRAINT "term_proposals_lever_check" CHECK ("lever" IN ('PURCHASE_PRICE', 'PRICE_REDUCTION', 'REMEDIATION_COST', 'ESCROW', 'INDEMNITY', 'RETENTION', 'EARNOUT', 'SELLER_FINANCING', 'FINANCING_CONTINGENCY', 'WORKING_CAPITAL_PEG'));
