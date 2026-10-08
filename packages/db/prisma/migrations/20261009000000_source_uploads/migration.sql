-- Source uploads: billing exports imported through a column mapping onto the
-- Pactlab standard invoice line. Expand-only, with one widened CHECK: an
-- uploaded export is live seller data that needs no credential, so
-- `billing_upload` connections may be LIVE without a credential reference.
-- Every row valid before stays valid (rollback: restore the old CHECK once no
-- billing_upload connections exist).

-- CreateEnum
CREATE TYPE "import_target" AS ENUM ('BILLING_INVOICE_LINE');

-- CreateEnum
CREATE TYPE "source_upload_status" AS ENUM ('UPLOADED', 'IMPORTED', 'REJECTED', 'PURGED');

-- CreateTable
CREATE TABLE "source_uploads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "connection_id" UUID,
    "target" "import_target" NOT NULL,
    "system" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "row_count" INTEGER NOT NULL,
    "header" JSONB NOT NULL,
    "mapping" JSONB,
    "mapping_version" TEXT,
    "object_key" TEXT,
    "status" "source_upload_status" NOT NULL DEFAULT 'UPLOADED',
    "sync_run_id" UUID,
    "visibility" "evidence_visibility" NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_at" TIMESTAMPTZ(3),
    "purged_at" TIMESTAMPTZ(3),

    CONSTRAINT "source_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_uploads_organization_id_deal_id_created_at_idx" ON "source_uploads"("organization_id", "deal_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "source_uploads_organization_id_deal_id_id_key" ON "source_uploads"("organization_id", "deal_id", "id");

-- AddForeignKey
ALTER TABLE "source_uploads" ADD CONSTRAINT "source_uploads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_uploads" ADD CONSTRAINT "source_uploads_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_uploads" ADD CONSTRAINT "source_uploads_organization_id_deal_id_connection_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "connection_id") REFERENCES "connections"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE connections DROP CONSTRAINT connections_credential_matches_mode;
ALTER TABLE connections ADD CONSTRAINT connections_credential_matches_mode
  CHECK (
    (provider = 'billing_upload' AND mode = 'LIVE' AND credential_ref IS NULL)
    OR (provider <> 'billing_upload' AND (mode = 'LIVE') = (credential_ref IS NOT NULL))
  );

-- ---------------------------------------------------------------------------
-- Integrity. Originals live under the row's tenant/deal prefix; an imported
-- upload names its mapping, connection and sync run; purge state is consistent.
-- The connection reference is composite so it stays in-tenant.
-- ---------------------------------------------------------------------------
ALTER TABLE source_uploads ADD CONSTRAINT source_uploads_object_key_tenant_prefix
  CHECK (object_key IS NULL OR starts_with(object_key, organization_id::text || '/' || deal_id::text || '/'));
ALTER TABLE source_uploads ADD CONSTRAINT source_uploads_sizes
  CHECK (size_bytes > 0 AND row_count >= 0 AND length(btrim(file_name)) > 0 AND length(btrim(system)) > 0);
ALTER TABLE source_uploads ADD CONSTRAINT source_uploads_imported_state
  CHECK (
    status <> 'IMPORTED'
    OR (mapping IS NOT NULL AND mapping_version IS NOT NULL AND connection_id IS NOT NULL
        AND sync_run_id IS NOT NULL AND imported_at IS NOT NULL)
  );
ALTER TABLE source_uploads ADD CONSTRAINT source_uploads_purge_state
  CHECK ((status = 'PURGED') = (purged_at IS NOT NULL) AND (status <> 'PURGED' OR object_key IS NULL));

-- ---------------------------------------------------------------------------
-- Privileges. Only the import and purge columns change; no DELETE.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON source_uploads TO pactlab_app;
GRANT UPDATE (connection_id, mapping, mapping_version, status, sync_run_id, imported_at, object_key, purged_at)
  ON source_uploads TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Row-level security. Same boundary as documents: buyer-only uploads are
-- hidden from target contributors, who may upload and read SHARED ones.
-- ---------------------------------------------------------------------------
ALTER TABLE source_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_uploads FORCE ROW LEVEL SECURITY;

CREATE POLICY source_uploads_select ON source_uploads FOR SELECT TO pactlab_app
  USING (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND (visibility = 'SHARED' OR app_is_buyer_side(deal_id))
  );
CREATE POLICY source_uploads_insert ON source_uploads FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND (visibility = 'SHARED' OR app_is_buyer_side(deal_id))
    AND uploaded_by = app_current_user_id()
  );
CREATE POLICY source_uploads_update ON source_uploads FOR UPDATE TO pactlab_app
  USING (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND (visibility = 'SHARED' OR app_is_buyer_side(deal_id))
  )
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND (visibility = 'SHARED' OR app_is_buyer_side(deal_id))
  );
