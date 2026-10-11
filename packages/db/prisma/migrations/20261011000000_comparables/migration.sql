-- Comparables and the deal lead's judgement of the asking price against them.
-- Expand-only; no existing object changes.

-- CreateEnum
CREATE TYPE "comparable_kind" AS ENUM ('PRECEDENT_TRANSACTION', 'PUBLIC_PEER', 'OWN_DEAL');

-- CreateEnum
CREATE TYPE "comparable_origin" AS ENUM ('OWN_DEAL', 'ENTERED', 'PROVIDER', 'SYNTHETIC');

-- CreateEnum
CREATE TYPE "comparable_status" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "multiple_verdict" AS ENUM ('IN_RANGE', 'HIGH', 'LOW');

-- CreateTable
CREATE TABLE "comparables" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "comparable_kind" NOT NULL,
    "origin" "comparable_origin" NOT NULL,
    "name" TEXT NOT NULL,
    "target_name" TEXT NOT NULL,
    "acquirer_name" TEXT,
    "announced_on" DATE,
    "company_type" "company_type" NOT NULL,
    "region" TEXT,
    "enterprise_value" DECIMAL(24,4) NOT NULL,
    "arr" DECIMAL(24,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "arr_growth" DECIMAL(9,4),
    "nrr" DECIMAL(9,4),
    "grr" DECIMAL(9,4),
    "source_citation" TEXT,
    "source_url" TEXT,
    "provider" TEXT,
    "provider_version" TEXT,
    "source_deal_id" UUID,
    "status" "comparable_status" NOT NULL DEFAULT 'ACTIVE',
    "recorded_by" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_by" UUID,
    "retired_at" TIMESTAMPTZ(3),

    CONSTRAINT "comparables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "multiple_judgements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "verdict" "multiple_verdict" NOT NULL,
    "rationale" TEXT NOT NULL,
    "asking_version" INTEGER,
    "asking_multiple" DECIMAL(12,2),
    "benchmark_version" TEXT NOT NULL,
    "comparable_set_hash" TEXT NOT NULL,
    "comparable_count" INTEGER NOT NULL,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "multiple_judgements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comparables_organization_id_status_company_type_idx" ON "comparables"("organization_id", "status", "company_type");

-- CreateIndex
CREATE UNIQUE INDEX "comparables_organization_id_source_deal_id_key" ON "comparables"("organization_id", "source_deal_id");

-- CreateIndex
CREATE INDEX "multiple_judgements_organization_id_deal_id_decided_at_idx" ON "multiple_judgements"("organization_id", "deal_id", "decided_at");

-- AddForeignKey
ALTER TABLE "comparables" ADD CONSTRAINT "comparables_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparables" ADD CONSTRAINT "comparables_organization_id_source_deal_id_fkey" FOREIGN KEY ("organization_id", "source_deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multiple_judgements" ADD CONSTRAINT "multiple_judgements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multiple_judgements" ADD CONSTRAINT "multiple_judgements_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Integrity. Positive EV and ARR in one ISO currency; drivers are fractions.
-- Every comparable says where it came from: entered rows cite a source,
-- provider rows name the provider and its data version, own deals point to
-- the deal. Synthetic rows exist only for demos and are labelled as such.
-- ---------------------------------------------------------------------------
ALTER TABLE comparables ADD CONSTRAINT comparables_values
  CHECK (
    enterprise_value > 0
    AND arr > 0
    AND currency ~ '^[A-Z]{3}$'
    AND (arr_growth IS NULL OR (arr_growth > -1 AND arr_growth < 100))
    AND (nrr IS NULL OR (nrr >= 0 AND nrr < 10))
    AND (grr IS NULL OR (grr >= 0 AND grr <= 1))
    AND length(name) BETWEEN 1 AND 200
    AND length(target_name) BETWEEN 1 AND 200
    AND (source_citation IS NULL OR length(source_citation) <= 1000)
    AND (source_url IS NULL OR (length(source_url) <= 2000 AND source_url ~ '^https://'))
  );
ALTER TABLE comparables ADD CONSTRAINT comparables_provenance
  CHECK (
    CASE origin
      WHEN 'ENTERED' THEN source_citation IS NOT NULL AND length(trim(source_citation)) >= 3 AND source_deal_id IS NULL
      WHEN 'PROVIDER' THEN provider IS NOT NULL AND provider_version IS NOT NULL AND source_deal_id IS NULL
      WHEN 'OWN_DEAL' THEN source_deal_id IS NOT NULL AND kind = 'OWN_DEAL'
      WHEN 'SYNTHETIC' THEN source_deal_id IS NULL AND name LIKE 'Synthetic %'
    END
  );
ALTER TABLE comparables ADD CONSTRAINT comparables_retirement
  CHECK ((status = 'RETIRED') = (retired_by IS NOT NULL AND retired_at IS NOT NULL));

ALTER TABLE multiple_judgements ADD CONSTRAINT multiple_judgements_values
  CHECK (
    length(trim(rationale)) BETWEEN 3 AND 2000
    AND (asking_version IS NULL OR asking_version >= 1)
    AND (asking_multiple IS NULL OR asking_multiple > 0)
    AND comparable_count >= 0
    AND comparable_set_hash ~ '^[0-9a-f]{64}$'
  );

-- ---------------------------------------------------------------------------
-- Buy-side analyst: an organization owner/admin, or anyone holding a
-- buyer-side role on at least one deal. Target contributors are not.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_is_buyer_analyst() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM organization_memberships o
       WHERE o.organization_id = app_current_organization_id()
         AND o.user_id = app_current_user_id()
         AND o.status = 'ACTIVE'
         AND o.role IN ('ORG_OWNER', 'ORG_ADMIN')
    ) OR EXISTS (
      SELECT 1 FROM deal_memberships m
       WHERE m.organization_id = app_current_organization_id()
         AND m.user_id = app_current_user_id()
         AND m.status = 'ACTIVE'
         AND m.role <> 'TARGET_CONTRIBUTOR'
    )
  $$;
GRANT EXECUTE ON FUNCTION app_is_buyer_analyst() TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Privileges. Comparables are never deleted; the only change is retirement.
-- Judgements are append-only.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON comparables TO pactlab_app;
GRANT UPDATE (status, retired_by, retired_at) ON comparables TO pactlab_app;
GRANT SELECT, INSERT ON multiple_judgements TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Row-level security. Comparables are the buying firm's market knowledge:
-- visible to its buy-side people, never to target contributors or other
-- organizations. Writers record themselves.
-- ---------------------------------------------------------------------------
ALTER TABLE comparables ENABLE ROW LEVEL SECURITY;
ALTER TABLE comparables FORCE ROW LEVEL SECURITY;

CREATE POLICY comparables_select ON comparables FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND app_is_buyer_analyst());
CREATE POLICY comparables_insert ON comparables FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND app_is_buyer_analyst()
    AND recorded_by = app_current_user_id() AND status = 'ACTIVE'
    AND (source_deal_id IS NULL OR (source_deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(source_deal_id)))
  );
CREATE POLICY comparables_retire ON comparables FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND app_is_buyer_analyst() AND status = 'ACTIVE')
  WITH CHECK (organization_id = app_current_organization_id() AND status = 'RETIRED' AND retired_by = app_current_user_id());

-- The lead's judgement is negotiation analysis: buyer side only.
ALTER TABLE multiple_judgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE multiple_judgements FORCE ROW LEVEL SECURITY;

CREATE POLICY multiple_judgements_select ON multiple_judgements FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY multiple_judgements_insert ON multiple_judgements FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
    AND decided_by = app_current_user_id()
  );
