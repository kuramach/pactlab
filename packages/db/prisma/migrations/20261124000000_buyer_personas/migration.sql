-- Buyer personas (T-105, ADR 0021): the persona a pact prices under, persona-priced
-- valuation runs, evaluations under a persona, adoptions, versioned term proposals the
-- seller sees once proposed, and the AI negotiation brief. Expand-only: nullable columns
-- and new tables. Rollback: drop the five tables, the trigger function and the columns.

-- 1. Where a persona is chosen, and what a run was priced under. Buyer-confidential: every
--    table below except the term proposals is buyer-side only.
ALTER TABLE "organizations" ADD COLUMN "default_persona" TEXT,
  ADD CONSTRAINT "organizations_default_persona_check" CHECK ("default_persona" IN ('QUALITY_COMPOUNDER', 'VALUE_INVESTOR', 'GRAVE_DANCER'));
ALTER TABLE "deals" ADD COLUMN "persona" TEXT,
  ADD CONSTRAINT "deals_persona_check" CHECK ("persona" IN ('QUALITY_COMPOUNDER', 'VALUE_INVESTOR', 'GRAVE_DANCER'));
ALTER TABLE "valuation_scenarios" ADD COLUMN "scenario_case" TEXT,
  ADD CONSTRAINT "valuation_scenarios_case_check" CHECK ("scenario_case" IN ('DOWNSIDE', 'BASE', 'UPSIDE'));
ALTER TABLE "valuation_runs" ADD COLUMN "persona" TEXT, ADD COLUMN "persona_version" TEXT, ADD COLUMN "persona_routing" JSONB,
  ADD CONSTRAINT "valuation_runs_persona_check" CHECK (
    ("persona" IS NULL AND "persona_version" IS NULL AND "persona_routing" IS NULL)
    OR ("persona" IN ('QUALITY_COMPOUNDER', 'VALUE_INVESTOR', 'GRAVE_DANCER') AND "persona_version" IS NOT NULL AND "persona_routing" IS NOT NULL));

-- Organization admins set the default; the API checks the role, the policy checks it again.
GRANT UPDATE ("default_persona", "updated_at") ON organizations TO pactlab_app;
CREATE POLICY organizations_admin_update ON organizations FOR UPDATE TO pactlab_app
  USING (id = app_current_organization_id() AND EXISTS (
    SELECT 1 FROM organization_memberships m
     WHERE m.organization_id = organizations.id AND m.user_id = app_current_user_id() AND m.role IN ('ORG_OWNER', 'ORG_ADMIN')))
  WITH CHECK (id = app_current_organization_id());
GRANT UPDATE ("scenario_case") ON valuation_scenarios TO pactlab_app;

-- 2. Evaluations: insert-only.
CREATE TABLE "pricing_evaluations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "persona" TEXT NOT NULL,
    "persona_version" TEXT NOT NULL,
    "run_ids" UUID[] NOT NULL,
    "cases" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "weighted_price" DECIMAL(20,2) NOT NULL,
    "term_mix" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_evaluations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pricing_evaluations_persona_check" CHECK ("persona" IN ('QUALITY_COMPOUNDER', 'VALUE_INVESTOR', 'GRAVE_DANCER')),
    CONSTRAINT "pricing_evaluations_runs_check" CHECK (cardinality("run_ids") BETWEEN 1 AND 3),
    CONSTRAINT "pricing_evaluations_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "pricing_evaluations_org_deal_id_key" ON "pricing_evaluations"("organization_id", "deal_id", "id");
CREATE INDEX "pricing_evaluations_org_deal_idx" ON "pricing_evaluations"("organization_id", "deal_id", "created_at");
ALTER TABLE "pricing_evaluations" ADD CONSTRAINT "pricing_evaluations_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Adoptions: append-only; the latest is the pact's active pricing.
CREATE TABLE "pricing_adoptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "adopted_by" UUID NOT NULL,
    "adopted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_adoptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pricing_adoptions_org_deal_idx" ON "pricing_adoptions"("organization_id", "deal_id", "adopted_at");
ALTER TABLE "pricing_adoptions" ADD CONSTRAINT "pricing_adoptions_evaluation_fkey" FOREIGN KEY ("organization_id", "deal_id", "evaluation_id") REFERENCES "pricing_evaluations"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Term proposals. A batch is drafted from an evaluation, its seller notes edited while a
--    draft, then proposed once. No persona column: these rows reach the seller.
CREATE TABLE "term_proposal_batches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposed_at" TIMESTAMPTZ(3),
    "proposed_by" UUID,

    CONSTRAINT "term_proposal_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "term_proposal_batches_version_check" CHECK ("version" >= 1),
    CONSTRAINT "term_proposal_batches_proposed_check" CHECK (("proposed_at" IS NULL) = ("proposed_by" IS NULL))
);
CREATE UNIQUE INDEX "term_proposal_batches_org_deal_id_key" ON "term_proposal_batches"("organization_id", "deal_id", "id");
CREATE UNIQUE INDEX "term_proposal_batches_version_key" ON "term_proposal_batches"("organization_id", "deal_id", "version");
ALTER TABLE "term_proposal_batches" ADD CONSTRAINT "term_proposal_batches_evaluation_fkey" FOREIGN KEY ("organization_id", "deal_id", "evaluation_id") REFERENCES "pricing_evaluations"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "term_proposals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "lever" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "finding_id" UUID,
    "seller_note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "term_proposals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "term_proposals_lever_check" CHECK ("lever" IN ('PRICE_REDUCTION', 'REMEDIATION_COST', 'ESCROW', 'INDEMNITY', 'RETENTION', 'EARNOUT', 'SELLER_FINANCING')),
    CONSTRAINT "term_proposals_amount_check" CHECK ("amount" >= 0),
    CONSTRAINT "term_proposals_note_check" CHECK (length("seller_note") <= 1000)
);
CREATE UNIQUE INDEX "term_proposals_batch_ordinal_key" ON "term_proposals"("batch_id", "ordinal");
ALTER TABLE "term_proposals" ADD CONSTRAINT "term_proposals_batch_fkey" FOREIGN KEY ("organization_id", "deal_id", "batch_id") REFERENCES "term_proposal_batches"("organization_id", "deal_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A proposed batch is frozen: it is proposed once, and neither it nor its terms change after.
CREATE FUNCTION app_term_proposals_frozen() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_TABLE_NAME = 'term_proposal_batches' THEN
    IF OLD.proposed_at IS NOT NULL THEN RAISE EXCEPTION 'term proposal batch % is already proposed', OLD.id; END IF;
    IF NEW.proposed_at IS NULL OR (to_jsonb(NEW) - 'proposed_at' - 'proposed_by') <> (to_jsonb(OLD) - 'proposed_at' - 'proposed_by') THEN
      RAISE EXCEPTION 'a term proposal batch only changes by being proposed';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM term_proposal_batches b WHERE b.id = OLD.batch_id AND b.proposed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'terms of proposed batch % are frozen', OLD.batch_id;
    END IF;
    IF (to_jsonb(NEW) - 'seller_note') <> (to_jsonb(OLD) - 'seller_note') THEN
      RAISE EXCEPTION 'only the seller note of a draft term changes';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER term_proposal_batches_frozen BEFORE UPDATE ON term_proposal_batches FOR EACH ROW EXECUTE FUNCTION app_term_proposals_frozen();
CREATE TRIGGER term_proposals_frozen BEFORE UPDATE ON term_proposals FOR EACH ROW EXECUTE FUNCTION app_term_proposals_frozen();

-- 5. The negotiation brief: insert-only, buyer-side.
CREATE TABLE "negotiation_briefs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "persona" TEXT NOT NULL,
    "persona_version" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "ai_run_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negotiation_briefs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "negotiation_briefs_persona_check" CHECK ("persona" IN ('QUALITY_COMPOUNDER', 'VALUE_INVESTOR', 'GRAVE_DANCER'))
);
CREATE INDEX "negotiation_briefs_org_deal_idx" ON "negotiation_briefs"("organization_id", "deal_id", "evaluation_id", "created_at");
ALTER TABLE "negotiation_briefs" ADD CONSTRAINT "negotiation_briefs_evaluation_fkey" FOREIGN KEY ("organization_id", "deal_id", "evaluation_id") REFERENCES "pricing_evaluations"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Grants and row security. Evaluations, adoptions and briefs: insert-only, buyer side.
--    Term proposals: the buyer side drafts and proposes; anyone on the pact (the seller's
--    contributors) reads a batch once it is proposed, never a draft.
GRANT SELECT, INSERT ON pricing_evaluations, pricing_adoptions, negotiation_briefs, term_proposal_batches, term_proposals TO pactlab_app;
GRANT UPDATE ("proposed_at", "proposed_by") ON term_proposal_batches TO pactlab_app;
GRANT UPDATE ("seller_note") ON term_proposals TO pactlab_app;
ALTER TABLE pricing_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_evaluations FORCE ROW LEVEL SECURITY;
ALTER TABLE pricing_adoptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_adoptions FORCE ROW LEVEL SECURITY;
ALTER TABLE negotiation_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE negotiation_briefs FORCE ROW LEVEL SECURITY;
ALTER TABLE term_proposal_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE term_proposal_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE term_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE term_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY pricing_evaluations_buyer_side ON pricing_evaluations FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY pricing_adoptions_buyer_side ON pricing_adoptions FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY negotiation_briefs_buyer_side ON negotiation_briefs FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY term_proposal_batches_buyer_side ON term_proposal_batches FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY term_proposal_batches_proposed ON term_proposal_batches FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND proposed_at IS NOT NULL);
CREATE POLICY term_proposals_buyer_side ON term_proposals FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY term_proposals_proposed ON term_proposals FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND EXISTS (SELECT 1 FROM term_proposal_batches b WHERE b.id = term_proposals.batch_id AND b.proposed_at IS NOT NULL));
