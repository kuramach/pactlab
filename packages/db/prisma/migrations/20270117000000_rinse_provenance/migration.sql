-- T-178d (ADR 0058 addendum): first-class provenance for folders finished in Pactlab Rinse, and the
-- hand-sourced claim origin. Expand only.
--
-- Rollback: DROP TABLE document_provenance; DROP TABLE rinse_sets;
--   UPDATE deal_claims SET origin = 'MANUAL' WHERE origin = 'HAND_SOURCED';
--   restore deal_claims_origin_check from 20261109000000_venture_raise_pack.

-- A hand-sourced entry is its own claim origin, no longer MANUAL with a labelled source.
ALTER TABLE "deal_claims" DROP CONSTRAINT "deal_claims_origin_check";
ALTER TABLE "deal_claims" ADD CONSTRAINT "deal_claims_origin_check" CHECK ("origin" IN ('SCREENING_RED_FLAG', 'MANUAL', 'PACK_RULE', 'HAND_SOURCED'));
-- T-178 recorded hand-sourced entries as MANUAL claims whose source ends with this label. The schema
-- owner migrates under FORCE ROW LEVEL SECURITY, so it is lifted for the backfill and restored.
ALTER TABLE "deal_claims" NO FORCE ROW LEVEL SECURITY;
UPDATE "deal_claims" SET "origin" = 'HAND_SOURCED' WHERE "origin" = 'MANUAL' AND "source" LIKE '%(Pactlab Rinse; not documentary evidence)';
ALTER TABLE "deal_claims" FORCE ROW LEVEL SECURITY;

-- One row per rinsed set as it reached the pact: the manifest's preparer, gap notes and source
-- discrepancies. Visibility follows how it came in: a seller's folder or archive is SHARED, the deal
-- team's own is BUYER_ONLY.
CREATE TABLE "rinse_sets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "manifest_set_id" UUID NOT NULL,
    "manifest_sha256" CHAR(64) NOT NULL,
    "name" TEXT NOT NULL,
    "pack" TEXT NOT NULL,
    "prepared_by" JSONB NOT NULL,
    "ready_at" TIMESTAMPTZ(3) NOT NULL,
    "generator_version" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "document_source_id" UUID,
    "visibility" "evidence_visibility" NOT NULL,
    "documents" INTEGER NOT NULL,
    "gaps" JSONB NOT NULL,
    "source_discrepancies" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rinse_sets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rinse_sets_origin_check" CHECK ("origin" IN ('SYNC', 'ARCHIVE')),
    CONSTRAINT "rinse_sets_sha_check" CHECK ("manifest_sha256" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "rinse_sets_org_deal_id_key" ON "rinse_sets"("organization_id", "deal_id", "id");
-- The same manifest is recorded once per visibility, however often its folder syncs.
CREATE UNIQUE INDEX "rinse_sets_manifest_key" ON "rinse_sets"("organization_id", "deal_id", "manifest_sha256", "visibility");
ALTER TABLE "rinse_sets" ADD CONSTRAINT "rinse_sets_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rinse_sets" ADD CONSTRAINT "rinse_sets_source_fkey" FOREIGN KEY ("organization_id", "deal_id", "document_source_id") REFERENCES "document_sources"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One row per document read from a rinsed set: the canonical copy the pact cites, the seller's original
-- it was converted from (left at the source), and the manifest entry (checks, conversion log, audit).
CREATE TABLE "document_provenance" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "rinse_set_id" UUID NOT NULL,
    "manifest_document_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "canonical_path" TEXT NOT NULL,
    "canonical_sha256" CHAR(64) NOT NULL,
    "original_path" TEXT,
    "original_sha256" CHAR(64),
    "original_size_bytes" BIGINT,
    "original_media_type" TEXT,
    "entry" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_provenance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_provenance_role_check" CHECK ("role" IN ('CONVERTED', 'AS_IS')),
    CONSTRAINT "document_provenance_original_check" CHECK (("role" = 'CONVERTED') = ("original_path" IS NOT NULL))
);
CREATE UNIQUE INDEX "document_provenance_document_set_key" ON "document_provenance"("organization_id", "deal_id", "document_id", "rinse_set_id");
ALTER TABLE "document_provenance" ADD CONSTRAINT "document_provenance_document_fkey" FOREIGN KEY ("organization_id", "deal_id", "document_id") REFERENCES "documents"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_provenance" ADD CONSTRAINT "document_provenance_set_fkey" FOREIGN KEY ("organization_id", "deal_id", "rinse_set_id") REFERENCES "rinse_sets"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only. Row security mirrors the documents it describes.
GRANT SELECT, INSERT ON "rinse_sets", "document_provenance" TO pactlab_app;
ALTER TABLE "rinse_sets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rinse_sets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "document_provenance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_provenance" FORCE ROW LEVEL SECURITY;

CREATE POLICY rinse_sets_select ON rinse_sets FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND (visibility = 'SHARED' OR app_is_buyer_side(deal_id)));
CREATE POLICY rinse_sets_insert ON rinse_sets FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND (visibility = 'SHARED' OR app_is_buyer_side(deal_id))
    AND created_by = app_current_user_id()
  );
CREATE POLICY rinse_sets_no_investors ON rinse_sets AS RESTRICTIVE FOR ALL TO pactlab_app USING (NOT (deal_id = ANY (app_current_investor_deal_ids())));

-- Visible exactly when its document is (the documents policies apply inside the subquery).
CREATE POLICY document_provenance_select ON document_provenance FOR SELECT TO pactlab_app
  USING (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND EXISTS (SELECT 1 FROM documents d WHERE d.organization_id = document_provenance.organization_id AND d.deal_id = document_provenance.deal_id AND d.id = document_provenance.document_id)
  );
CREATE POLICY document_provenance_insert ON document_provenance FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND created_by = app_current_user_id()
    AND EXISTS (SELECT 1 FROM documents d WHERE d.organization_id = document_provenance.organization_id AND d.deal_id = document_provenance.deal_id AND d.id = document_provenance.document_id)
    AND EXISTS (SELECT 1 FROM rinse_sets s WHERE s.organization_id = document_provenance.organization_id AND s.deal_id = document_provenance.deal_id AND s.id = document_provenance.rinse_set_id)
  );
CREATE POLICY document_provenance_no_investors ON document_provenance AS RESTRICTIVE FOR ALL TO pactlab_app USING (NOT (deal_id = ANY (app_current_investor_deal_ids())));
