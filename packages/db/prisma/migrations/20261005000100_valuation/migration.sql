-- Valuation persistence: scenarios, insert-only assumption sets, runs and
-- frozen submissions, append-only decisions. Expand-only; no existing object
-- changes.

-- CreateEnum
CREATE TYPE "scenario_status" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "submission_decision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "valuation_scenarios" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "transaction_type" "transaction_type" NOT NULL,
    "status" "scenario_status" NOT NULL DEFAULT 'DRAFT',
    "assumption_version" INTEGER NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL,

    CONSTRAINT "valuation_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_assumption_sets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "scenario_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "valuation_assumption_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "scenario_id" UUID NOT NULL,
    "assumption_version" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "ran_by" UUID NOT NULL,
    "ran_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "valuation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_submissions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "scenario_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "canonical" TEXT NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "valuation_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_submission_decisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "decision" "submission_decision" NOT NULL,
    "rationale" TEXT NOT NULL,
    "decided_by" UUID NOT NULL,
    "decided_role" "deal_role" NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "valuation_submission_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "valuation_scenarios_organization_id_deal_id_created_at_idx" ON "valuation_scenarios"("organization_id", "deal_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_scenarios_organization_id_deal_id_id_key" ON "valuation_scenarios"("organization_id", "deal_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_assumption_sets_organization_id_deal_id_scenario__key" ON "valuation_assumption_sets"("organization_id", "deal_id", "scenario_id", "version");

-- CreateIndex
CREATE INDEX "valuation_runs_organization_id_deal_id_scenario_id_ran_at_idx" ON "valuation_runs"("organization_id", "deal_id", "scenario_id", "ran_at");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_runs_organization_id_deal_id_id_key" ON "valuation_runs"("organization_id", "deal_id", "id");

-- CreateIndex
CREATE INDEX "valuation_submissions_organization_id_deal_id_scenario_id_s_idx" ON "valuation_submissions"("organization_id", "deal_id", "scenario_id", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_submissions_organization_id_deal_id_id_key" ON "valuation_submissions"("organization_id", "deal_id", "id");

-- CreateIndex
CREATE INDEX "valuation_submission_decisions_organization_id_deal_id_subm_idx" ON "valuation_submission_decisions"("organization_id", "deal_id", "submission_id", "decided_at");

-- AddForeignKey
ALTER TABLE "valuation_scenarios" ADD CONSTRAINT "valuation_scenarios_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_scenarios" ADD CONSTRAINT "valuation_scenarios_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_assumption_sets" ADD CONSTRAINT "valuation_assumption_sets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_assumption_sets" ADD CONSTRAINT "valuation_assumption_sets_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_assumption_sets" ADD CONSTRAINT "valuation_assumption_sets_organization_id_deal_id_scenario_fkey" FOREIGN KEY ("organization_id", "deal_id", "scenario_id") REFERENCES "valuation_scenarios"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_runs" ADD CONSTRAINT "valuation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_runs" ADD CONSTRAINT "valuation_runs_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_runs" ADD CONSTRAINT "valuation_runs_organization_id_deal_id_scenario_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "scenario_id") REFERENCES "valuation_scenarios"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_submissions" ADD CONSTRAINT "valuation_submissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_submissions" ADD CONSTRAINT "valuation_submissions_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_submissions" ADD CONSTRAINT "valuation_submissions_organization_id_deal_id_scenario_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "scenario_id") REFERENCES "valuation_scenarios"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_submissions" ADD CONSTRAINT "valuation_submissions_organization_id_deal_id_run_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "run_id") REFERENCES "valuation_runs"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_submission_decisions" ADD CONSTRAINT "valuation_submission_decisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_submission_decisions" ADD CONSTRAINT "valuation_submission_decisions_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_submission_decisions" ADD CONSTRAINT "valuation_submission_decisions_organization_id_deal_id_sub_fkey" FOREIGN KEY ("organization_id", "deal_id", "submission_id") REFERENCES "valuation_submissions"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity. Frozen bytes are tied to their digest in the database itself;
-- versions are positive.
-- ---------------------------------------------------------------------------
ALTER TABLE valuation_scenarios ADD CONSTRAINT valuation_scenarios_currency
  CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE valuation_scenarios ADD CONSTRAINT valuation_scenarios_versions
  CHECK (version >= 1 AND assumption_version >= 1);
ALTER TABLE valuation_assumption_sets ADD CONSTRAINT valuation_assumption_sets_version
  CHECK (version >= 1);
ALTER TABLE valuation_submissions ADD CONSTRAINT valuation_submissions_digest_matches
  CHECK (digest = encode(sha256(convert_to(canonical, 'UTF8')), 'hex'));
ALTER TABLE valuation_submission_decisions ADD CONSTRAINT valuation_submission_decisions_rationale
  CHECK (length(btrim(rationale)) > 0);

-- ---------------------------------------------------------------------------
-- Privileges. Scenarios change only status and version columns; assumption
-- sets, runs, submissions and decisions are insert-only. No DELETE anywhere.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON valuation_scenarios, valuation_assumption_sets, valuation_runs,
  valuation_submissions, valuation_submission_decisions TO pactlab_app;
GRANT UPDATE (status, assumption_version, updated_at, version) ON valuation_scenarios TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Row-level security. Valuation is buyer-side: tenant + deal scope and never
-- visible to target contributors. Actors are always the caller.
-- ---------------------------------------------------------------------------
ALTER TABLE valuation_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE valuation_scenarios FORCE ROW LEVEL SECURITY;
ALTER TABLE valuation_assumption_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE valuation_assumption_sets FORCE ROW LEVEL SECURITY;
ALTER TABLE valuation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE valuation_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE valuation_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE valuation_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE valuation_submission_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE valuation_submission_decisions FORCE ROW LEVEL SECURITY;

CREATE POLICY valuation_scenarios_buyer_side ON valuation_scenarios FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY valuation_assumption_sets_buyer_side ON valuation_assumption_sets FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
    AND created_by = app_current_user_id()
  );
CREATE POLICY valuation_runs_buyer_side ON valuation_runs FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
    AND ran_by = app_current_user_id()
  );
CREATE POLICY valuation_submissions_buyer_side ON valuation_submissions FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
    AND submitted_by = app_current_user_id()
  );
CREATE POLICY valuation_submission_decisions_buyer_side ON valuation_submission_decisions FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
    AND decided_by = app_current_user_id()
    -- Four eyes: the submitter never decides their own submission.
    AND NOT EXISTS (
      SELECT 1 FROM valuation_submissions s
       WHERE s.id = valuation_submission_decisions.submission_id AND s.submitted_by = app_current_user_id()
    )
  );
