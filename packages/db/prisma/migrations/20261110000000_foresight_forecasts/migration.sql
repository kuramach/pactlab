-- T-094 B10: Foresight numeric forecasts (published, AI, user) and the baseline refresh state.
-- Expand-only: two new tables; nothing existing changes.

CREATE TABLE "foresight_forecasts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "metric_key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "first_year" INTEGER NOT NULL,
    "values" DECIMAL(9,4)[] NOT NULL,
    "source_name" TEXT,
    "source_url" TEXT,
    "source_as_of" DATE,
    "rationale" TEXT,
    "model_id" TEXT,
    "prompt_id" TEXT,
    "prompt_version" TEXT,
    "ai_run_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "foresight_forecasts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "foresight_forecasts_source_check" CHECK ("source" IN ('EXTERNAL', 'AI', 'USER')),
    CONSTRAINT "foresight_forecasts_values_check" CHECK (cardinality("values") = 5),
    CONSTRAINT "foresight_forecasts_year_check" CHECK ("first_year" BETWEEN 2000 AND 2200),
    CONSTRAINT "foresight_forecasts_metric_check" CHECK (length("metric_key") BETWEEN 1 AND 80),
    CONSTRAINT "foresight_forecasts_user_check" CHECK ("source" <> 'USER' OR "created_by" IS NOT NULL)
);
CREATE UNIQUE INDEX "foresight_forecasts_metric_version_key" ON "foresight_forecasts"("organization_id", "deal_id", "metric_key", "source", "version");
CREATE INDEX "foresight_forecasts_organization_id_deal_id_created_at_idx" ON "foresight_forecasts"("organization_id", "deal_id", "created_at");
ALTER TABLE "foresight_forecasts" ADD CONSTRAINT "foresight_forecasts_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "foresight_baselines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "foresight_baselines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "foresight_baselines_status_check" CHECK ("status" IN ('RUNNING', 'READY', 'PARTIAL', 'FAILED'))
);
CREATE UNIQUE INDEX "foresight_baselines_organization_id_deal_id_key" ON "foresight_baselines"("organization_id", "deal_id");
ALTER TABLE "foresight_baselines" ADD CONSTRAINT "foresight_baselines_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Buyer-side analysis, like the rest of Foresight: target contributors never see it.
GRANT SELECT, INSERT, UPDATE ON foresight_forecasts, foresight_baselines TO pactlab_app;
ALTER TABLE foresight_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE foresight_forecasts FORCE ROW LEVEL SECURITY;
ALTER TABLE foresight_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE foresight_baselines FORCE ROW LEVEL SECURITY;
CREATE POLICY foresight_forecasts_buyer_side ON foresight_forecasts FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY foresight_baselines_buyer_side ON foresight_baselines FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
