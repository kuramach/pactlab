-- T-179 (ADR 0060): Deal Criticals. The buyer organization's red-line parameters, kept as
-- org standards (deal_id NULL, scoped to a company type or all types) and pact criticals
-- (pact-only, or an override of an org standard for one pact). Append-only and versioned:
-- every change, including a person's confirmation, is the next version of the same key.
-- Only a CONFIRMED version evaluates; a PROPOSED one is inert. Ratings are stamped with the
-- version they ran under. Buyer-confidential: the seller never sees a critical, a threshold
-- or a rating.
-- Expand only. Rollback: drop critical_evaluations, then deal_criticals.
CREATE TABLE "deal_criticals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID,
    "critical_key" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "company_type" TEXT,
    "overrides_key" UUID,
    "words" TEXT,
    "metric" TEXT,
    "comparator" TEXT,
    "threshold" DECIMAL(24,6),
    "lookback_years" INTEGER,
    "even_band" DECIMAL(24,6),
    "state" TEXT NOT NULL,
    "structure_source" TEXT,
    "reason" TEXT,
    "promoted_from_key" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_criticals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deal_criticals_scope_check" CHECK (("scope" = 'ORG' AND "deal_id" IS NULL AND "overrides_key" IS NULL) OR ("scope" = 'PACT' AND "deal_id" IS NOT NULL AND "company_type" IS NULL)),
    CONSTRAINT "deal_criticals_state_check" CHECK ("state" IN ('PROPOSED', 'CONFIRMED', 'DISABLED', 'RETIRED')),
    CONSTRAINT "deal_criticals_metric_check" CHECK ("metric" IS NULL OR "metric" IN ('CAP_RATE', 'OCCUPANCY', 'OCCUPANCY_LOW', 'NOI_GROWTH', 'RENT_GROWTH', 'EXPENSE_RATIO', 'DSCR', 'ANCHOR_LEASE_YEARS', 'NET_REVENUE_RETENTION')),
    CONSTRAINT "deal_criticals_comparator_check" CHECK ("comparator" IS NULL OR "comparator" IN ('AT_LEAST', 'AT_MOST')),
    CONSTRAINT "deal_criticals_source_check" CHECK ("structure_source" IS NULL OR "structure_source" IN ('AI', 'PERSON')),
    -- A confirmed version carries its whole structure; the engine runs nothing else.
    CONSTRAINT "deal_criticals_confirmed_check" CHECK ("state" <> 'CONFIRMED' OR ("metric" IS NOT NULL AND "comparator" IS NOT NULL AND "threshold" IS NOT NULL AND "structure_source" IS NOT NULL)),
    -- An org standard is written in words or as a structure; an override always says why (who and when are the row).
    CONSTRAINT "deal_criticals_content_check" CHECK ("words" IS NOT NULL OR "metric" IS NOT NULL OR "state" IN ('DISABLED', 'RETIRED')),
    CONSTRAINT "deal_criticals_override_check" CHECK ("overrides_key" IS NULL OR ("reason" IS NOT NULL AND length("reason") >= 3)),
    CONSTRAINT "deal_criticals_disabled_check" CHECK ("state" <> 'DISABLED' OR "overrides_key" IS NOT NULL),
    CONSTRAINT "deal_criticals_lookback_check" CHECK ("lookback_years" IS NULL OR "lookback_years" BETWEEN 1 AND 5),
    CONSTRAINT "deal_criticals_band_check" CHECK ("even_band" IS NULL OR "even_band" >= 0),
    CONSTRAINT "deal_criticals_version_check" CHECK ("version" >= 1)
);
CREATE UNIQUE INDEX "deal_criticals_key_version_key" ON "deal_criticals"("organization_id", "critical_key", "version");
CREATE INDEX "deal_criticals_org_scope_idx" ON "deal_criticals"("organization_id", "scope", "deal_id", "created_at");
ALTER TABLE "deal_criticals" ADD CONSTRAINT "deal_criticals_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deal_criticals" ADD CONSTRAINT "deal_criticals_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only: a change is the next version.
GRANT SELECT, INSERT ON deal_criticals TO pactlab_app;
ALTER TABLE deal_criticals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_criticals FORCE ROW LEVEL SECURITY;
-- Org standards: the buying organization's own buy-side people (as comparables); pact criticals: the pact's own side.
CREATE POLICY deal_criticals_select ON deal_criticals FOR SELECT TO pactlab_app
  USING (
    organization_id = app_current_organization_id()
    AND ((deal_id IS NULL AND app_is_org_member() AND app_is_buyer_analyst())
      OR (deal_id IS NOT NULL AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)))
  );
CREATE POLICY deal_criticals_insert ON deal_criticals FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND created_by = app_current_user_id()
    AND ((deal_id IS NULL AND app_is_org_member() AND app_is_buyer_analyst())
      OR (deal_id IS NOT NULL AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)))
  );

-- One row per critical per evaluation run: the rating, its receipts and the version it ran under.
CREATE TABLE "critical_evaluations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "critical_key" UUID NOT NULL,
    "critical_version" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "override_key" UUID,
    "override_version" INTEGER,
    "snapshot" JSONB NOT NULL,
    "rating" TEXT NOT NULL,
    "receipts" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "missing" TEXT,
    "policy_breach" BOOLEAN NOT NULL DEFAULT false,
    "finding_id" UUID,
    "evidence_mark" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "evaluated_by" UUID NOT NULL,
    "evaluated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "critical_evaluations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "critical_evaluations_origin_check" CHECK ("origin" IN ('ORG', 'PACT')),
    CONSTRAINT "critical_evaluations_rating_check" CHECK ("rating" IN ('GOOD', 'EVEN', 'BAD', 'NO_EVIDENCE')),
    -- No evidence always names what would settle it; a breach is a Bad on an org standard.
    CONSTRAINT "critical_evaluations_missing_check" CHECK (("rating" = 'NO_EVIDENCE') = ("missing" IS NOT NULL)),
    CONSTRAINT "critical_evaluations_breach_check" CHECK (NOT "policy_breach" OR ("rating" = 'BAD' AND "origin" = 'ORG')),
    CONSTRAINT "critical_evaluations_override_check" CHECK (("override_key" IS NULL) = ("override_version" IS NULL) AND ("override_key" IS NULL OR "origin" = 'ORG'))
);
CREATE UNIQUE INDEX "critical_evaluations_run_critical_key" ON "critical_evaluations"("organization_id", "deal_id", "run_id", "critical_key");
CREATE INDEX "critical_evaluations_deal_idx" ON "critical_evaluations"("organization_id", "deal_id", "evaluated_at");
ALTER TABLE "critical_evaluations" ADD CONSTRAINT "critical_evaluations_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT ON critical_evaluations TO pactlab_app;
ALTER TABLE critical_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE critical_evaluations FORCE ROW LEVEL SECURITY;
CREATE POLICY critical_evaluations_buyer_side ON critical_evaluations FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id) AND evaluated_by = app_current_user_id());
