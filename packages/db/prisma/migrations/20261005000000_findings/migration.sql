-- Findings persistence: findings, insert-only evidence links and append-only
-- human reviews. Expand-only; no existing object changes.

-- CreateEnum
CREATE TYPE "finding_domain" AS ENUM ('ARCHITECTURE', 'MAINTAINABILITY', 'SECURITY', 'OSS_LICENSE', 'TEST_QUALITY', 'OPERATIONS', 'CODE_PROVENANCE', 'KEY_PERSON');

-- CreateEnum
CREATE TYPE "finding_severity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "finding_confidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "finding_status" AS ENUM ('DRAFT', 'IN_REVIEW', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "finding_origin" AS ENUM ('SCANNER', 'HEURISTIC', 'AI', 'HUMAN');

-- CreateEnum
CREATE TYPE "review_decision" AS ENUM ('SUBMITTED', 'SUPPORT_REQUESTED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "priced_risk_type" AS ENUM ('PRICE_REDUCTION', 'ESCROW', 'INDEMNITY', 'REMEDIATION_COST');

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "domain" "finding_domain" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "finding_severity" NOT NULL,
    "confidence" "finding_confidence" NOT NULL,
    "status" "finding_status" NOT NULL DEFAULT 'DRAFT',
    "origin" "finding_origin" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "priced_risk_type" "priced_risk_type",
    "priced_risk_currency" CHAR(3),
    "priced_risk_low" DECIMAL(19,4),
    "priced_risk_high" DECIMAL(19,4),
    "priced_risk_basis" TEXT,
    "created_by" JSONB NOT NULL,
    "evidence_version" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_evidence_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "finding_version" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "evidence_item_id" UUID NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "tool_version" TEXT NOT NULL,
    "ruleset_version" TEXT,
    "path" TEXT,
    "line_start" INTEGER,
    "line_end" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_evidence_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_reviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "decision" "review_decision" NOT NULL,
    "from_status" "finding_status" NOT NULL,
    "to_status" "finding_status" NOT NULL,
    "reviewer_user_id" UUID NOT NULL,
    "reviewer_role" "deal_role" NOT NULL,
    "rationale" TEXT NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "finding_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "findings_organization_id_deal_id_status_domain_idx" ON "findings"("organization_id", "deal_id", "status", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "findings_organization_id_deal_id_id_key" ON "findings"("organization_id", "deal_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "findings_organization_id_deal_id_fingerprint_key" ON "findings"("organization_id", "deal_id", "fingerprint");

-- CreateIndex
CREATE INDEX "finding_evidence_links_organization_id_deal_id_evidence_ite_idx" ON "finding_evidence_links"("organization_id", "deal_id", "evidence_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "finding_evidence_links_organization_id_deal_id_finding_id_f_key" ON "finding_evidence_links"("organization_id", "deal_id", "finding_id", "finding_version", "ordinal");

-- CreateIndex
CREATE INDEX "finding_reviews_organization_id_deal_id_finding_id_decided__idx" ON "finding_reviews"("organization_id", "deal_id", "finding_id", "decided_at");

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_evidence_links" ADD CONSTRAINT "finding_evidence_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_evidence_links" ADD CONSTRAINT "finding_evidence_links_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_evidence_links" ADD CONSTRAINT "finding_evidence_links_organization_id_deal_id_finding_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "finding_id") REFERENCES "findings"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_evidence_links" ADD CONSTRAINT "finding_evidence_links_organization_id_deal_id_evidence_it_fkey" FOREIGN KEY ("organization_id", "deal_id", "evidence_item_id") REFERENCES "evidence_items"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_reviews" ADD CONSTRAINT "finding_reviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_reviews" ADD CONSTRAINT "finding_reviews_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_reviews" ADD CONSTRAINT "finding_reviews_organization_id_deal_id_finding_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "finding_id") REFERENCES "findings"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity. Priced risk is all-or-none, non-negative and ordered; evidence
-- links carry an exact commit and a repository-relative path only.
-- ---------------------------------------------------------------------------
ALTER TABLE findings ADD CONSTRAINT findings_priced_risk_complete
  CHECK (
    (priced_risk_type IS NULL AND priced_risk_currency IS NULL AND priced_risk_low IS NULL
       AND priced_risk_high IS NULL AND priced_risk_basis IS NULL)
    OR
    (priced_risk_type IS NOT NULL AND priced_risk_currency ~ '^[A-Z]{3}$'
       AND priced_risk_low >= 0 AND priced_risk_high >= priced_risk_low
       AND length(btrim(priced_risk_basis)) > 0)
  );
ALTER TABLE findings ADD CONSTRAINT findings_created_by_actor
  CHECK (created_by ->> 'kind' IN ('HUMAN', 'AI', 'SYSTEM'));
ALTER TABLE findings ADD CONSTRAINT findings_versions
  CHECK (version >= 1 AND evidence_version >= 1 AND evidence_version <= version);

ALTER TABLE finding_evidence_links ADD CONSTRAINT finding_evidence_links_commit_sha
  CHECK (commit_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$');
ALTER TABLE finding_evidence_links ADD CONSTRAINT finding_evidence_links_relative_path
  CHECK (path IS NULL OR (left(path, 1) <> '/' AND NOT ('..' = ANY (string_to_array(path, '/')))));
ALTER TABLE finding_evidence_links ADD CONSTRAINT finding_evidence_links_line_range
  CHECK ((line_start IS NULL OR line_start >= 1) AND (line_end IS NULL OR line_end >= coalesce(line_start, 1)));

-- ---------------------------------------------------------------------------
-- Privileges. Findings mutate only in reviewable columns; links and reviews
-- are insert-only. No DELETE anywhere.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON findings, finding_evidence_links, finding_reviews TO pactlab_app;
GRANT UPDATE (title, description, severity, confidence, status, priced_risk_type, priced_risk_currency,
              priced_risk_low, priced_risk_high, priced_risk_basis, evidence_version, version, updated_at)
  ON findings TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Row-level security. Findings are buyer-side analysis: tenant + deal scope
-- and never visible to target contributors.
-- ---------------------------------------------------------------------------
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings FORCE ROW LEVEL SECURITY;
ALTER TABLE finding_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE finding_evidence_links FORCE ROW LEVEL SECURITY;
ALTER TABLE finding_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE finding_reviews FORCE ROW LEVEL SECURITY;

CREATE POLICY findings_buyer_side ON findings FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY finding_evidence_links_buyer_side ON finding_evidence_links FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY finding_reviews_buyer_side ON finding_reviews FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
    AND reviewer_user_id = app_current_user_id()
  );
