-- Buyer financing (T-117, ADR 0033): how the buyer funds the deal, attested by the buyer and shown to
-- the seller as structure, status and coverage. One plan per buyer on a pact: the pact's own side on a
-- buyer-led pact (bid_id NULL), or each bidder on a seller-led one (bid_id). Tranches, an earnest-money
-- deposit held by a third party, and financing documents shared with the seller one by one.
-- Never feeds valuation, findings or price. Expand-only: new tables, a nullable column on
-- term_proposals and a wider lever check. Rollback: drop the financing_* tables and term_proposals.due_on;
-- restore the lever check from 20261126000000_two_sided_close.

CREATE TABLE "financing_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "bid_id" UUID,
    "commitment_expected_by" DATE,
    "buyer_note" TEXT NOT NULL DEFAULT '',
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financing_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "financing_plans_org_deal_id_key" UNIQUE ("organization_id", "deal_id", "id"),
    CONSTRAINT "financing_plans_note_check" CHECK (char_length("buyer_note") <= 2000),
    CONSTRAINT "financing_plans_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "financing_plans_bid_fkey" FOREIGN KEY ("organization_id", "deal_id", "bid_id") REFERENCES "bids"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- One plan per buyer on a pact.
CREATE UNIQUE INDEX "financing_plans_buyer_key" ON "financing_plans"("deal_id", COALESCE("bid_id", '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE "financing_tranches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "label" TEXT NOT NULL DEFAULT '',
    "buyer_note" TEXT NOT NULL DEFAULT '',
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financing_tranches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "financing_tranches_ordinal_key" UNIQUE ("plan_id", "ordinal"),
    CONSTRAINT "financing_tranches_kind_check" CHECK ("kind" IN ('CASH', 'SBA_7A', 'CONVENTIONAL_DEBT', 'SELLER_NOTE', 'ROLLOVER_EQUITY', 'OTHER')),
    CONSTRAINT "financing_tranches_status_check" CHECK ("status" IN ('NOT_STARTED', 'EXPLORING', 'PRE_QUALIFIED', 'APPLICATION_SUBMITTED', 'COMMITMENT_ISSUED', 'CLEARED_TO_CLOSE')),
    CONSTRAINT "financing_tranches_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "financing_tranches_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "financing_tranches_text_check" CHECK (char_length("label") <= 120 AND char_length("buyer_note") <= 2000),
    CONSTRAINT "financing_tranches_plan_fkey" FOREIGN KEY ("organization_id", "deal_id", "plan_id") REFERENCES "financing_plans"("organization_id", "deal_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Commitment cash in escrow (earnest money), held by a third party, never Pactlab. One per plan.
CREATE TABLE "financing_escrows" (
    "plan_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "holder_kind" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "deposit_due_on" DATE,
    "hard_on" DATE,
    "refund_conditions" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'COMMITTED',
    "deposited_on" DATE,
    "deposit_reference" TEXT,
    "proof_document_id" UUID,
    "deposit_recorded_by" UUID,
    "deposit_recorded_at" TIMESTAMPTZ(3),
    "confirmed_by" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "disputed_at" TIMESTAMPTZ(3),
    "dispute_note" TEXT,
    "disposition_by" UUID,
    "disposition_at" TIMESTAMPTZ(3),
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financing_escrows_pkey" PRIMARY KEY ("plan_id"),
    CONSTRAINT "financing_escrows_org_deal_plan_key" UNIQUE ("organization_id", "deal_id", "plan_id"),
    CONSTRAINT "financing_escrows_holder_check" CHECK ("holder_kind" IN ('TITLE_COMPANY', 'ATTORNEY', 'BROKER', 'OTHER') AND char_length(btrim("holder_name")) BETWEEN 2 AND 160),
    CONSTRAINT "financing_escrows_status_check" CHECK ("status" IN ('NOT_COMMITTED', 'COMMITTED', 'DEPOSITED', 'APPLIED_AT_CLOSE', 'RELEASED_TO_SELLER', 'REFUNDED_TO_BUYER')),
    CONSTRAINT "financing_escrows_amount_check" CHECK ("amount" > 0 AND "currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "financing_escrows_text_check" CHECK (char_length("refund_conditions") <= 2000 AND ("dispute_note" IS NULL OR char_length("dispute_note") <= 1000) AND ("deposit_reference" IS NULL OR char_length("deposit_reference") <= 200)),
    CONSTRAINT "financing_escrows_deposit_check" CHECK ("status" <> 'DEPOSITED' OR ("deposited_on" IS NOT NULL AND "deposit_recorded_at" IS NOT NULL)),
    CONSTRAINT "financing_escrows_plan_fkey" FOREIGN KEY ("organization_id", "deal_id", "plan_id") REFERENCES "financing_plans"("organization_id", "deal_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Financing documents: proof of funds, lender letters. Buyer-only until shared, one by one; revocable.
CREATE TABLE "financing_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "tranche_id" UUID,
    "purpose" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "object_key" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shared_at" TIMESTAMPTZ(3),
    "shared_by" UUID,
    CONSTRAINT "financing_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "financing_documents_purpose_check" CHECK ("purpose" IN ('PROOF_OF_FUNDS', 'PRE_QUALIFICATION', 'COMMITMENT_LETTER', 'SBA_PRE_QUALIFICATION', 'ESCROW_RECEIPT', 'BUYER_FINANCIALS', 'OTHER')),
    CONSTRAINT "financing_documents_type_check" CHECK ("content_type" = 'application/pdf'),
    CONSTRAINT "financing_documents_size_check" CHECK ("byte_size" BETWEEN 1 AND 10485760 AND char_length("file_name") BETWEEN 1 AND 200),
    CONSTRAINT "financing_documents_plan_fkey" FOREIGN KEY ("organization_id", "deal_id", "plan_id") REFERENCES "financing_plans"("organization_id", "deal_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "financing_documents_tranche_fkey" FOREIGN KEY ("tranche_id") REFERENCES "financing_tranches"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "financing_documents_plan_idx" ON "financing_documents"("plan_id", "uploaded_at");
ALTER TABLE "financing_escrows" ADD CONSTRAINT "financing_escrows_proof_fkey" FOREIGN KEY ("proof_document_id") REFERENCES "financing_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A financing contingency term (T-117): the financed amount it covers, and the date it must be met by.
ALTER TABLE "term_proposals" ADD COLUMN "due_on" DATE;
ALTER TABLE "term_proposals" DROP CONSTRAINT "term_proposals_lever_check",
  ADD CONSTRAINT "term_proposals_lever_check" CHECK ("lever" IN ('PURCHASE_PRICE', 'PRICE_REDUCTION', 'REMEDIATION_COST', 'ESCROW', 'INDEMNITY', 'RETENTION', 'EARNOUT', 'SELLER_FINANCING', 'FINANCING_CONTINGENCY')),
  ADD CONSTRAINT "term_proposals_due_on_check" CHECK (("lever" = 'FINANCING_CONTINGENCY') = ("due_on" IS NOT NULL));

-- Who is the buyer of a plan, and who may read it.
-- The buyer: the own side of a buyer-led pact (no bid), or the bidder whose bid it is.
CREATE FUNCTION app_is_financing_buyer(target_deal uuid, target_bid uuid) RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT CASE WHEN target_bid IS NULL
      THEN app_is_own_side(target_deal) AND EXISTS (SELECT 1 FROM deals d WHERE d.id = target_deal AND d.initiated_by = 'BUYER')
      ELSE target_bid = app_current_bid_id(target_deal) END
  $$;
-- The seller: the seller's contributors on a buyer-led pact; the seller's own side on a seller-led one (every bid).
CREATE FUNCTION app_is_financing_seller(target_deal uuid, target_bid uuid) RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT CASE WHEN target_bid IS NULL THEN app_is_seller_contributor(target_deal) ELSE app_is_own_side(target_deal) END
  $$;

ALTER TABLE financing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE financing_tranches ENABLE ROW LEVEL SECURITY;
ALTER TABLE financing_escrows ENABLE ROW LEVEL SECURITY;
ALTER TABLE financing_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE financing_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE financing_tranches FORCE ROW LEVEL SECURITY;
ALTER TABLE financing_escrows FORCE ROW LEVEL SECURITY;
ALTER TABLE financing_documents FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON financing_plans TO pactlab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON financing_tranches TO pactlab_app;
GRANT SELECT, INSERT, UPDATE ON financing_escrows TO pactlab_app;
GRANT SELECT, INSERT, UPDATE ON financing_documents TO pactlab_app;
GRANT UPDATE ("due_on") ON term_proposals TO pactlab_app;

CREATE POLICY financing_plans_buyer ON financing_plans FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_financing_buyer(deal_id, bid_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_financing_buyer(deal_id, bid_id));
CREATE POLICY financing_plans_seller ON financing_plans FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_financing_seller(deal_id, bid_id));

-- Children follow their plan: the plan's buyer writes; its seller reads (documents: shared ones only).
CREATE POLICY financing_tranches_buyer ON financing_tranches FOR ALL TO pactlab_app
  USING (EXISTS (SELECT 1 FROM financing_plans p WHERE p.id = plan_id AND app_is_financing_buyer(p.deal_id, p.bid_id)))
  WITH CHECK (organization_id = app_current_organization_id() AND EXISTS (SELECT 1 FROM financing_plans p WHERE p.id = plan_id AND p.deal_id = financing_tranches.deal_id AND app_is_financing_buyer(p.deal_id, p.bid_id)));
CREATE POLICY financing_tranches_seller ON financing_tranches FOR SELECT TO pactlab_app
  USING (EXISTS (SELECT 1 FROM financing_plans p WHERE p.id = plan_id AND app_is_financing_seller(p.deal_id, p.bid_id)));

CREATE POLICY financing_escrows_buyer ON financing_escrows FOR ALL TO pactlab_app
  USING (EXISTS (SELECT 1 FROM financing_plans p WHERE p.id = plan_id AND app_is_financing_buyer(p.deal_id, p.bid_id)))
  WITH CHECK (organization_id = app_current_organization_id() AND EXISTS (SELECT 1 FROM financing_plans p WHERE p.id = plan_id AND p.deal_id = financing_escrows.deal_id AND app_is_financing_buyer(p.deal_id, p.bid_id)));
CREATE POLICY financing_escrows_seller_read ON financing_escrows FOR SELECT TO pactlab_app
  USING (EXISTS (SELECT 1 FROM financing_plans p WHERE p.id = plan_id AND app_is_financing_seller(p.deal_id, p.bid_id)));
-- The seller confirms or disputes a recorded deposit (the service checks what changes).
CREATE POLICY financing_escrows_seller_answer ON financing_escrows FOR UPDATE TO pactlab_app
  USING (EXISTS (SELECT 1 FROM financing_plans p WHERE p.id = plan_id AND app_is_financing_seller(p.deal_id, p.bid_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM financing_plans p WHERE p.id = plan_id AND app_is_financing_seller(p.deal_id, p.bid_id)));

CREATE POLICY financing_documents_buyer ON financing_documents FOR ALL TO pactlab_app
  USING (EXISTS (SELECT 1 FROM financing_plans p WHERE p.id = plan_id AND app_is_financing_buyer(p.deal_id, p.bid_id)))
  WITH CHECK (organization_id = app_current_organization_id() AND uploaded_by = app_current_user_id()
              AND EXISTS (SELECT 1 FROM financing_plans p WHERE p.id = plan_id AND p.deal_id = financing_documents.deal_id AND app_is_financing_buyer(p.deal_id, p.bid_id)));
CREATE POLICY financing_documents_seller ON financing_documents FOR SELECT TO pactlab_app
  USING (shared_at IS NOT NULL AND EXISTS (SELECT 1 FROM financing_plans p WHERE p.id = plan_id AND app_is_financing_seller(p.deal_id, p.bid_id)));
