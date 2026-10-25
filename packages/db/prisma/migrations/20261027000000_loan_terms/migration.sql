-- T-078: loan terms on debt items (pilot bug 12). Expand only: nullable
-- columns on the item and on every version, so each revision keeps the terms
-- it had. Terms are allowed on DEBT items only. Rates are fractions (0.075 =
-- 7.5 %), stored as numeric — never floating point.
ALTER TABLE "balance_sheet_items"
  ADD COLUMN "interest_rate" NUMERIC(9, 6),
  ADD COLUMN "rate_type" TEXT,
  ADD COLUMN "rate_reference" TEXT,
  ADD COLUMN "maturity_date" DATE,
  ADD COLUMN "lender" TEXT,
  ADD COLUMN "repayment" TEXT,
  ADD COLUMN "covenant_note" TEXT;
ALTER TABLE "balance_sheet_item_versions"
  ADD COLUMN "interest_rate" NUMERIC(9, 6),
  ADD COLUMN "rate_type" TEXT,
  ADD COLUMN "rate_reference" TEXT,
  ADD COLUMN "maturity_date" DATE,
  ADD COLUMN "lender" TEXT,
  ADD COLUMN "repayment" TEXT,
  ADD COLUMN "covenant_note" TEXT;

ALTER TABLE "balance_sheet_items" ADD CONSTRAINT "balance_sheet_items_terms_check" CHECK (
  ("interest_rate" IS NULL OR ("interest_rate" >= 0 AND "interest_rate" < 1))
  AND ("rate_type" IS NULL OR "rate_type" IN ('FIXED', 'FLOATING'))
  AND ("repayment" IS NULL OR "repayment" IN ('AMORTIZING', 'BULLET', 'REVOLVING'))
  AND (kind = 'DEBT' OR ("interest_rate" IS NULL AND "rate_type" IS NULL AND "rate_reference" IS NULL AND "maturity_date" IS NULL AND "lender" IS NULL AND "repayment" IS NULL AND "covenant_note" IS NULL))
);
ALTER TABLE "balance_sheet_item_versions" ADD CONSTRAINT "balance_sheet_item_versions_terms_check" CHECK (
  ("interest_rate" IS NULL OR ("interest_rate" >= 0 AND "interest_rate" < 1))
  AND ("rate_type" IS NULL OR "rate_type" IN ('FIXED', 'FLOATING'))
  AND ("repayment" IS NULL OR "repayment" IN ('AMORTIZING', 'BULLET', 'REVOLVING'))
  AND (kind = 'DEBT' OR ("interest_rate" IS NULL AND "rate_type" IS NULL AND "rate_reference" IS NULL AND "maturity_date" IS NULL AND "lender" IS NULL AND "repayment" IS NULL AND "covenant_note" IS NULL))
);

GRANT UPDATE ("interest_rate", "rate_type", "rate_reference", "maturity_date", "lender", "repayment", "covenant_note") ON balance_sheet_items TO pactlab_app;
