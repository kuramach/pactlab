-- T-098 (ADR 0016): documents read from a connected data room or drive, and
-- requests to the seller for what is missing.
--
-- Expand only: two new tables and nullable columns on documents.
-- Rollback: drop the tables and the columns; nothing else reads them.

-- A data room or drive folder the buyer reads documents from. Read-only:
-- Pactlab never writes, moves or shares files at the source.
CREATE TABLE "document_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    -- Provider-specific, non-secret: which room or folder.
    "config" JSONB NOT NULL,
    -- A reference into the secret store, never a secret.
    "credential_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_synced_at" TIMESTAMPTZ(3),
    "last_sync_summary" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_sources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_sources_mode_check" CHECK ("mode" IN ('FIXTURE', 'LIVE')),
    CONSTRAINT "document_sources_status_check" CHECK ("status" IN ('ACTIVE', 'DISABLED')),
    CONSTRAINT "document_sources_provider_check" CHECK ("provider" IN ('google-drive', 'onedrive', 'vdr')),
    CONSTRAINT "document_sources_credential_check" CHECK ("credential_ref" IS NULL OR "credential_ref" LIKE 'secretref:%')
);
CREATE UNIQUE INDEX "document_sources_org_deal_id_key" ON "document_sources"("organization_id", "deal_id", "id");
CREATE INDEX "document_sources_org_deal_created_idx" ON "document_sources"("organization_id", "deal_id", "created_at");
ALTER TABLE "document_sources" ADD CONSTRAINT "document_sources_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Where a document came from in its source, and whether it is still there.
ALTER TABLE documents
  ADD COLUMN source_id          uuid,
  ADD COLUMN source_external_id text,
  ADD COLUMN source_version     text,
  ADD COLUMN source_state       text,
  ADD COLUMN recategorized_from text,
  ADD COLUMN recategorized_at   timestamptz(3);
ALTER TABLE documents
  ADD CONSTRAINT documents_source_state_check
    CHECK (source_state IS NULL OR source_state IN ('CURRENT', 'REPLACED', 'REMOVED')),
  ADD CONSTRAINT documents_source_fields_check
    CHECK ((source_id IS NULL) = (source_external_id IS NULL) AND (source_id IS NULL) = (source_state IS NULL)),
  ADD CONSTRAINT documents_source_fkey
    FOREIGN KEY (organization_id, deal_id, source_id) REFERENCES document_sources (organization_id, deal_id, id) ON DELETE RESTRICT;
CREATE INDEX documents_source_idx ON documents (organization_id, deal_id, source_id, source_external_id);
GRANT UPDATE (source_state, recategorized_from, recategorized_at) ON documents TO pactlab_app;

-- A request to the seller for what is missing. Both sides of the pact see it:
-- it names categories only, never buyer analysis.
CREATE TABLE "document_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    -- Expected-input ids (categories) asked for, in order.
    "items" TEXT[] NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "document_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_requests_status_check" CHECK ("status" IN ('OPEN', 'CLOSED')),
    CONSTRAINT "document_requests_items_check" CHECK (cardinality("items") BETWEEN 1 AND 50),
    CONSTRAINT "document_requests_note_check" CHECK ("note" IS NULL OR length("note") <= 2000)
);
CREATE INDEX "document_requests_org_deal_created_idx" ON "document_requests"("organization_id", "deal_id", "created_at");
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON document_sources, document_requests TO pactlab_app;
ALTER TABLE document_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE document_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_requests FORCE ROW LEVEL SECURITY;

-- Sources are buyer-side configuration.
CREATE POLICY document_sources_buyer_side ON document_sources FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));

-- Requests: everyone on the pact reads them; only the buyer side writes them.
CREATE POLICY document_requests_select ON document_requests FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
CREATE POLICY document_requests_insert ON document_requests FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id) AND created_by = app_current_user_id());
CREATE POLICY document_requests_update ON document_requests FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
