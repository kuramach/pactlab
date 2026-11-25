-- T-154 (ADR 0039): withdraw an import and re-import, audit-safe. Nothing is
-- deleted: a withdrawn upload keeps its record, file, mapping and counts; the
-- evidence it alone held is voided (kept, excluded from read paths); a
-- re-import is a new upload that supersedes the withdrawn one.
-- Expand only. Rollback: drop evidence_voids and sync_run_evidence, the four
-- source_uploads columns and their constraints (no row is WITHDRAWN before this
-- release; set any back to IMPORTED first). The enum value stays, unused.

-- ---------------------------------------------------------------------------
-- Withdrawal and lineage on the upload.
-- ---------------------------------------------------------------------------
ALTER TABLE "source_uploads"
  ADD COLUMN "withdrawn_at" TIMESTAMPTZ(3),
  ADD COLUMN "withdrawn_by" UUID,
  ADD COLUMN "withdrawal_reason" TEXT,
  ADD COLUMN "supersedes_upload_id" UUID;

CREATE UNIQUE INDEX "source_uploads_organization_id_deal_id_supersedes_upload_id_key" ON "source_uploads"("organization_id", "deal_id", "supersedes_upload_id");
ALTER TABLE "source_uploads" ADD CONSTRAINT "source_uploads_organization_id_deal_id_supersedes_upload_i_fkey" FOREIGN KEY ("organization_id", "deal_id", "supersedes_upload_id") REFERENCES "source_uploads"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Who, when and why: all three on a withdrawn upload (kept if its pact is later deleted and the
-- file purged); a withdrawn upload was imported.
ALTER TABLE source_uploads ADD CONSTRAINT source_uploads_withdrawn_state
  CHECK (
    (status <> 'WITHDRAWN' OR withdrawn_at IS NOT NULL)
    AND (withdrawn_at IS NULL OR status IN ('WITHDRAWN', 'PURGED'))
    AND ((withdrawn_at IS NULL) = (withdrawn_by IS NULL))
    AND ((withdrawn_at IS NULL) = (withdrawal_reason IS NULL))
    AND (withdrawal_reason IS NULL OR length(btrim(withdrawal_reason)) BETWEEN 3 AND 500)
    AND (status <> 'WITHDRAWN'
      OR (mapping IS NOT NULL AND mapping_version IS NOT NULL AND connection_id IS NOT NULL
          AND sync_run_id IS NOT NULL AND imported_at IS NOT NULL))
  );
ALTER TABLE source_uploads ADD CONSTRAINT source_uploads_supersedes_other
  CHECK (supersedes_upload_id IS NULL OR supersedes_upload_id <> id);

GRANT UPDATE (withdrawn_at, withdrawn_by, withdrawal_reason) ON source_uploads TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Which evidence each sync run read. Backfilled from first and last runs.
-- ---------------------------------------------------------------------------
CREATE TABLE "sync_run_evidence" (
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "sync_run_id" UUID NOT NULL,
    "evidence_item_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_run_evidence_pkey" PRIMARY KEY ("sync_run_id", "evidence_item_id")
);
CREATE INDEX "sync_run_evidence_organization_id_deal_id_evidence_item_id_idx" ON "sync_run_evidence"("organization_id", "deal_id", "evidence_item_id");
ALTER TABLE "sync_run_evidence" ADD CONSTRAINT "sync_run_evidence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_run_evidence" ADD CONSTRAINT "sync_run_evidence_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_run_evidence" ADD CONSTRAINT "sync_run_evidence_organization_id_deal_id_sync_run_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "sync_run_id") REFERENCES "sync_runs"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_run_evidence" ADD CONSTRAINT "sync_run_evidence_organization_id_deal_id_evidence_item_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "evidence_item_id") REFERENCES "evidence_items"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- evidence_items is forced: the owner reads nothing through RLS without lifting it.
ALTER TABLE evidence_items NO FORCE ROW LEVEL SECURITY;
INSERT INTO sync_run_evidence (organization_id, deal_id, sync_run_id, evidence_item_id)
  SELECT organization_id, deal_id, first_sync_run_id, id FROM evidence_items
  UNION
  SELECT organization_id, deal_id, last_sync_run_id, id FROM evidence_items;
ALTER TABLE evidence_items FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON sync_run_evidence TO pactlab_app;
ALTER TABLE sync_run_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_run_evidence FORCE ROW LEVEL SECURITY;
-- Visible only with its evidence (the subquery runs under evidence_items RLS).
CREATE POLICY sync_run_evidence_tenant ON sync_run_evidence FOR ALL TO pactlab_app
  USING (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND EXISTS (SELECT 1 FROM evidence_items e WHERE e.id = sync_run_evidence.evidence_item_id)
  )
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));

-- ---------------------------------------------------------------------------
-- Voided evidence. Never deleted; a later import holding the record again
-- restores it, recorded on the row.
-- ---------------------------------------------------------------------------
CREATE TABLE "evidence_voids" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "evidence_item_id" UUID NOT NULL,
    "source_upload_id" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_by" UUID NOT NULL,
    "restored_at" TIMESTAMPTZ(3),
    "restored_by_upload_id" UUID,

    CONSTRAINT "evidence_voids_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evidence_voids_restored_state" CHECK (("restored_at" IS NULL) = ("restored_by_upload_id" IS NULL))
);
CREATE UNIQUE INDEX "evidence_voids_organization_id_deal_id_evidence_item_id_sou_key" ON "evidence_voids"("organization_id", "deal_id", "evidence_item_id", "source_upload_id");
CREATE INDEX "evidence_voids_organization_id_deal_id_source_upload_id_idx" ON "evidence_voids"("organization_id", "deal_id", "source_upload_id");
ALTER TABLE "evidence_voids" ADD CONSTRAINT "evidence_voids_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_voids" ADD CONSTRAINT "evidence_voids_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_voids" ADD CONSTRAINT "evidence_voids_organization_id_deal_id_evidence_item_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "evidence_item_id") REFERENCES "evidence_items"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_voids" ADD CONSTRAINT "evidence_voids_organization_id_deal_id_source_upload_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "source_upload_id") REFERENCES "source_uploads"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No DELETE; only the restore columns change.
GRANT SELECT, INSERT ON evidence_voids TO pactlab_app;
GRANT UPDATE (restored_at, restored_by_upload_id) ON evidence_voids TO pactlab_app;
ALTER TABLE evidence_voids ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_voids FORCE ROW LEVEL SECURITY;
-- Visible only with its evidence, so a void never names a buyer-only item to a counterparty.
CREATE POLICY evidence_voids_tenant ON evidence_voids FOR ALL TO pactlab_app
  USING (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND EXISTS (SELECT 1 FROM evidence_items e WHERE e.id = evidence_voids.evidence_item_id)
  )
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND EXISTS (SELECT 1 FROM evidence_items e WHERE e.id = evidence_voids.evidence_item_id)
  );
