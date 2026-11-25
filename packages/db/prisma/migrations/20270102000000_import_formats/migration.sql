-- Saved import formats (ADR 0042): a confirmed mapping, reused on the next file with the same layout signature
-- without the assistant. Pact-scoped; visibility follows the upload it was confirmed on (as source_uploads).
-- Expand only. Rollback: DROP TABLE import_formats (uploads keep their own mappings).
CREATE TABLE "import_formats" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "target" "import_target" NOT NULL,
    "signature" CHAR(64) NOT NULL,
    "header_row" INTEGER,
    "mapping" JSONB NOT NULL,
    "source_upload_id" UUID NOT NULL,
    "source_file_name" TEXT NOT NULL,
    "visibility" "evidence_visibility" NOT NULL,
    "confirmed_by" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "import_formats_pkey" PRIMARY KEY ("id")
);
-- One per visibility: a seller's shared format and the buyer's own never overwrite each other.
CREATE UNIQUE INDEX "import_formats_organization_id_deal_id_target_signature_visibil_key" ON "import_formats"("organization_id", "deal_id", "target", "signature", "visibility");
CREATE INDEX "import_formats_organization_id_deal_id_target_idx" ON "import_formats"("organization_id", "deal_id", "target");
ALTER TABLE "import_formats" ADD CONSTRAINT "import_formats_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_formats" ADD CONSTRAINT "import_formats_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No DELETE: a format is replaced by the next confirmation, never erased (its use is in the audit chain).
GRANT SELECT, INSERT, UPDATE ON import_formats TO pactlab_app;
ALTER TABLE import_formats ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_formats FORCE ROW LEVEL SECURITY;
CREATE POLICY import_formats_tenant ON import_formats FOR ALL TO pactlab_app
  USING (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND (visibility = 'SHARED' OR app_is_buyer_side(deal_id))
  )
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND (visibility = 'SHARED' OR app_is_buyer_side(deal_id))
  );
