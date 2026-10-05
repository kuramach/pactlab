-- Documents persistence: documents, pages, AI-run metadata, AI-drafted
-- document findings and append-only named human reviews. Expand-only; no
-- existing object changes.

-- CreateEnum
CREATE TYPE "data_classification" AS ENUM ('PUBLIC', 'BUSINESS', 'FINANCIAL', 'HR', 'COMPENSATION', 'PERFORMANCE', 'NAMED_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "retention_class" AS ENUM ('DEAL_TERM', 'SHORT_90D', 'LEGAL_HOLD');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('AVAILABLE', 'PURGED');

-- CreateEnum
CREATE TYPE "ai_run_status" AS ENUM ('SUCCEEDED', 'SCHEMA_INVALID', 'PROVIDER_ERROR');

-- CreateEnum
CREATE TYPE "document_finding_status" AS ENUM ('DRAFT', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "document_finding_kind" AS ENUM ('PARTY', 'DATE', 'CLAUSE');

-- CreateEnum
CREATE TYPE "document_review_decision" AS ENUM ('ACCEPT', 'REJECT');

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "object_key" TEXT NOT NULL,
    "page_count" INTEGER NOT NULL,
    "data_class" "data_classification" NOT NULL,
    "ai_excluded" BOOLEAN NOT NULL,
    "retention_class" "retention_class" NOT NULL,
    "retain_until" TIMESTAMPTZ(3),
    "visibility" "evidence_visibility" NOT NULL,
    "malware_scanner" TEXT NOT NULL,
    "status" "document_status" NOT NULL DEFAULT 'AVAILABLE',
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "purged_at" TIMESTAMPTZ(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_pages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "text" TEXT,
    "checksum" CHAR(64) NOT NULL,

    CONSTRAINT "document_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "task_type" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "prompt_hash" TEXT NOT NULL,
    "model_alias" TEXT NOT NULL,
    "resolved_model_id" TEXT NOT NULL,
    "input_hashes" TEXT[],
    "output_hash" TEXT,
    "status" "ai_run_status" NOT NULL,
    "repair_attempted" BOOLEAN NOT NULL,
    "injection_signals" INTEGER NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_findings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "ai_run_id" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "kind" "document_finding_kind" NOT NULL,
    "subtype" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "severity" "finding_severity" NOT NULL,
    "status" "document_finding_status" NOT NULL DEFAULT 'DRAFT',
    "fingerprint" TEXT NOT NULL,
    "citations" JSONB NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "prompt_hash" TEXT NOT NULL,
    "resolved_model_id" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "reviewer_user_id" UUID,
    "reviewer_display_name" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_finding_reviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "decision" "document_review_decision" NOT NULL,
    "reviewer_user_id" UUID NOT NULL,
    "reviewer_display_name" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_finding_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_organization_id_deal_id_sha256_idx" ON "documents"("organization_id", "deal_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "documents_organization_id_deal_id_id_key" ON "documents"("organization_id", "deal_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_object_key_key" ON "documents"("object_key");

-- CreateIndex
CREATE UNIQUE INDEX "document_pages_organization_id_deal_id_document_id_page_num_key" ON "document_pages"("organization_id", "deal_id", "document_id", "page_number");

-- CreateIndex
CREATE INDEX "ai_runs_organization_id_deal_id_created_at_idx" ON "ai_runs"("organization_id", "deal_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_runs_organization_id_deal_id_id_key" ON "ai_runs"("organization_id", "deal_id", "id");

-- CreateIndex
CREATE INDEX "document_findings_organization_id_deal_id_status_idx" ON "document_findings"("organization_id", "deal_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_findings_organization_id_deal_id_id_key" ON "document_findings"("organization_id", "deal_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_findings_organization_id_deal_id_document_id_finge_key" ON "document_findings"("organization_id", "deal_id", "document_id", "fingerprint");

-- CreateIndex
CREATE INDEX "document_finding_reviews_organization_id_deal_id_finding_id_idx" ON "document_finding_reviews"("organization_id", "deal_id", "finding_id", "decided_at");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_organization_id_deal_id_document_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "document_id") REFERENCES "documents"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_findings" ADD CONSTRAINT "document_findings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_findings" ADD CONSTRAINT "document_findings_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_findings" ADD CONSTRAINT "document_findings_organization_id_deal_id_document_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "document_id") REFERENCES "documents"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_findings" ADD CONSTRAINT "document_findings_organization_id_deal_id_ai_run_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "ai_run_id") REFERENCES "ai_runs"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_finding_reviews" ADD CONSTRAINT "document_finding_reviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_finding_reviews" ADD CONSTRAINT "document_finding_reviews_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_finding_reviews" ADD CONSTRAINT "document_finding_reviews_organization_id_deal_id_finding_i_fkey" FOREIGN KEY ("organization_id", "deal_id", "finding_id") REFERENCES "document_findings"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity. Originals live under the row's tenant/deal prefix; prohibited
-- data classes are always AI-excluded; purge state is consistent.
-- ---------------------------------------------------------------------------
ALTER TABLE documents ADD CONSTRAINT documents_object_key_tenant_prefix
  CHECK (starts_with(object_key, organization_id::text || '/' || deal_id::text || '/'));
ALTER TABLE documents ADD CONSTRAINT documents_content_type
  CHECK (content_type IN ('text/plain', 'text/markdown'));
ALTER TABLE documents ADD CONSTRAINT documents_prohibited_classes_ai_excluded
  CHECK (ai_excluded OR data_class NOT IN ('HR', 'COMPENSATION', 'PERFORMANCE', 'NAMED_CONTRIBUTION'));
ALTER TABLE documents ADD CONSTRAINT documents_purge_state
  CHECK ((status = 'PURGED') = (purged_at IS NOT NULL));
ALTER TABLE documents ADD CONSTRAINT documents_sizes
  CHECK (size_bytes > 0 AND page_count >= 1);
ALTER TABLE document_pages ADD CONSTRAINT document_pages_page_number
  CHECK (page_number >= 1);
ALTER TABLE document_findings ADD CONSTRAINT document_findings_cited
  CHECK (jsonb_typeof(citations) = 'array' AND jsonb_array_length(citations) > 0);
ALTER TABLE document_findings ADD CONSTRAINT document_findings_named_decision
  CHECK (
    (status = 'DRAFT' AND reviewer_user_id IS NULL AND reviewer_display_name IS NULL AND decided_at IS NULL)
    OR (status <> 'DRAFT' AND reviewer_user_id IS NOT NULL AND length(btrim(reviewer_display_name)) > 0
        AND decided_at IS NOT NULL)
  );
ALTER TABLE document_finding_reviews ADD CONSTRAINT document_finding_reviews_rationale
  CHECK (length(btrim(rationale)) > 0 AND length(btrim(reviewer_display_name)) > 0);

-- ---------------------------------------------------------------------------
-- Privileges. Documents change only purge columns, pages only their text
-- (purge), findings only decision columns; AI runs and reviews are
-- insert-only. No DELETE anywhere.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON documents, document_pages, ai_runs, document_findings, document_finding_reviews
  TO pactlab_app;
GRANT UPDATE (status, purged_at) ON documents TO pactlab_app;
GRANT UPDATE (text) ON document_pages TO pactlab_app;
GRANT UPDATE (status, reviewer_user_id, reviewer_display_name, decided_at, version) ON document_findings TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Row-level security. Documents follow the evidence boundary: buyer-only rows
-- are hidden from target contributors, who may upload and read SHARED
-- documents only. Pages are visible exactly when their document is. AI runs
-- and document findings are buyer-side analysis.
-- ---------------------------------------------------------------------------
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE document_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_pages FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE document_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_findings FORCE ROW LEVEL SECURITY;
ALTER TABLE document_finding_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_finding_reviews FORCE ROW LEVEL SECURITY;

CREATE POLICY documents_select ON documents FOR SELECT TO pactlab_app
  USING (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND (visibility = 'SHARED' OR app_is_buyer_side(deal_id))
  );
CREATE POLICY documents_insert ON documents FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND (visibility = 'SHARED' OR app_is_buyer_side(deal_id))
    AND uploaded_by = app_current_user_id()
  );
CREATE POLICY documents_update ON documents FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));

-- The subquery runs under documents RLS, so pages of hidden documents stay hidden.
CREATE POLICY document_pages_select ON document_pages FOR SELECT TO pactlab_app
  USING (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_pages.document_id)
  );
CREATE POLICY document_pages_insert ON document_pages FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_pages.document_id)
  );
CREATE POLICY document_pages_update ON document_pages FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));

CREATE POLICY ai_runs_buyer_side ON ai_runs FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY document_findings_buyer_side ON document_findings FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
    AND (reviewer_user_id IS NULL OR reviewer_user_id = app_current_user_id())
  );
CREATE POLICY document_finding_reviews_buyer_side ON document_finding_reviews FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id)
    AND reviewer_user_id = app_current_user_id()
  );
