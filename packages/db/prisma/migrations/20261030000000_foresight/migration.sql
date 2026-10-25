-- T-073: Foresight (codename Nostradamus). Expand only: four buyer-side tables.
-- A trend set is the AI baseline (dated, model- and prompt-versioned);
-- scenarios layer the user's own view on top without editing the baseline;
-- questions keep transcripts and answers (never audio).

CREATE TABLE "foresight_trend_sets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "as_of" DATE NOT NULL,
    "provenance" TEXT NOT NULL DEFAULT 'AI',
    "model_id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "ai_run_id" UUID,
    "base_growth" NUMERIC(9, 6) NOT NULL DEFAULT 0.10,
    "base_margin" NUMERIC(9, 6) NOT NULL DEFAULT 0.20,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "foresight_trend_sets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "foresight_trend_sets_provenance_check" CHECK ("provenance" = 'AI'),
    CONSTRAINT "foresight_trend_sets_assumptions_check" CHECK ("base_growth" > -0.5 AND "base_growth" < 2 AND "base_margin" > 0 AND "base_margin" < 1)
);
CREATE UNIQUE INDEX "foresight_trend_sets_organization_id_deal_id_id_key" ON "foresight_trend_sets"("organization_id", "deal_id", "id");
CREATE INDEX "foresight_trend_sets_organization_id_deal_id_created_at_idx" ON "foresight_trend_sets"("organization_id", "deal_id", "created_at");
ALTER TABLE "foresight_trend_sets" ADD CONSTRAINT "foresight_trend_sets_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "foresight_trends" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "trend_set_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "magnitude" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "effects" JSONB NOT NULL,
    CONSTRAINT "foresight_trends_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "foresight_trends_values_check" CHECK ("direction" IN ('UP', 'FLAT', 'DOWN') AND "magnitude" IN ('LOW', 'MEDIUM', 'HIGH') AND "confidence" IN ('LOW', 'MEDIUM', 'HIGH') AND "category" IN ('MACRO', 'SECTOR'))
);
CREATE UNIQUE INDEX "foresight_trends_set_key" ON "foresight_trends"("organization_id", "deal_id", "trend_set_id", "key");
ALTER TABLE "foresight_trends" ADD CONSTRAINT "foresight_trends_set_fkey" FOREIGN KEY ("organization_id", "deal_id", "trend_set_id") REFERENCES "foresight_trend_sets"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "foresight_scenarios" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "trend_set_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_growth" NUMERIC(9, 6) NOT NULL,
    "base_margin" NUMERIC(9, 6) NOT NULL,
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "custom_trends" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "foresight_scenarios_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "foresight_scenarios_name_check" CHECK (length("name") BETWEEN 1 AND 120),
    CONSTRAINT "foresight_scenarios_assumptions_check" CHECK ("base_growth" > -0.5 AND "base_growth" < 2 AND "base_margin" > 0 AND "base_margin" < 1),
    CONSTRAINT "foresight_scenarios_json_check" CHECK (jsonb_typeof("overrides") = 'object' AND jsonb_typeof("custom_trends") = 'array')
);
CREATE UNIQUE INDEX "foresight_scenarios_organization_id_deal_id_id_key" ON "foresight_scenarios"("organization_id", "deal_id", "id");
ALTER TABLE "foresight_scenarios" ADD CONSTRAINT "foresight_scenarios_set_fkey" FOREIGN KEY ("organization_id", "deal_id", "trend_set_id") REFERENCES "foresight_trend_sets"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "foresight_questions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "scenario_id" UUID,
    "via" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "relies_on" TEXT[] NOT NULL DEFAULT '{}',
    "ai_run_id" UUID,
    "asked_by" UUID NOT NULL,
    "asked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "foresight_questions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "foresight_questions_via_check" CHECK ("via" IN ('TEXT', 'VOICE'))
);
CREATE INDEX "foresight_questions_organization_id_deal_id_asked_at_idx" ON "foresight_questions"("organization_id", "deal_id", "asked_at");
ALTER TABLE "foresight_questions" ADD CONSTRAINT "foresight_questions_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT ON foresight_trend_sets, foresight_trends, foresight_questions TO pactlab_app;
GRANT SELECT, INSERT, UPDATE ON foresight_scenarios TO pactlab_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['foresight_trend_sets', 'foresight_trends', 'foresight_scenarios', 'foresight_questions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO pactlab_app USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)) WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))', t || '_buyer_side', t);
  END LOOP;
END
$$;
