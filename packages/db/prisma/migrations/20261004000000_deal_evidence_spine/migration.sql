-- Deal/evidence spine (T-002): connections, sync runs, evidence, lineage edges, citations.
-- Expand-only: new tables, types and policies; nothing existing is altered.

-- CreateEnum
CREATE TYPE "connection_mode" AS ENUM ('FIXTURE', 'LIVE');

-- CreateEnum
CREATE TYPE "connection_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "sync_run_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "evidence_visibility" AS ENUM ('BUYER_ONLY', 'SHARED');

-- CreateEnum
CREATE TYPE "evidence_edge_type" AS ENUM ('SUPERSEDES', 'DERIVED_FROM');

-- CreateTable
CREATE TABLE "connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "mode" "connection_mode" NOT NULL,
    "credential_ref" TEXT,
    "config" JSONB NOT NULL,
    "status" "connection_status" NOT NULL DEFAULT 'ACTIVE',
    "evidence_visibility" "evidence_visibility" NOT NULL DEFAULT 'BUYER_ONLY',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "connector_version" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "sync_run_status" NOT NULL DEFAULT 'QUEUED',
    "cursor" TEXT,
    "records_seen" INTEGER NOT NULL DEFAULT 0,
    "records_created" INTEGER NOT NULL DEFAULT 0,
    "records_unchanged" INTEGER NOT NULL DEFAULT 0,
    "issues_count" INTEGER NOT NULL DEFAULT 0,
    "error_class" TEXT,
    "requested_by" UUID NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "first_sync_run_id" UUID NOT NULL,
    "last_sync_run_id" UUID NOT NULL,
    "evidence_type" TEXT NOT NULL,
    "source_system" TEXT NOT NULL,
    "source_record_id" TEXT NOT NULL,
    "observed_at" TIMESTAMPTZ(3),
    "canonical" JSONB NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "sensitivity" TEXT NOT NULL DEFAULT 'STANDARD',
    "visibility" "evidence_visibility" NOT NULL DEFAULT 'BUYER_ONLY',
    "shared_by" UUID,
    "shared_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_edges" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "from_evidence_id" UUID NOT NULL,
    "to_evidence_id" UUID NOT NULL,
    "edge_type" "evidence_edge_type" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "evidence_item_id" UUID NOT NULL,
    "locator" JSONB NOT NULL,
    "quote_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "citations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connections_organization_id_deal_id_created_at_idx" ON "connections"("organization_id", "deal_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "connections_organization_id_deal_id_id_key" ON "connections"("organization_id", "deal_id", "id");

-- CreateIndex
CREATE INDEX "sync_runs_organization_id_deal_id_connection_id_created_at_idx" ON "sync_runs"("organization_id", "deal_id", "connection_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sync_runs_organization_id_deal_id_id_key" ON "sync_runs"("organization_id", "deal_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_runs_organization_id_deal_id_idempotency_key_key" ON "sync_runs"("organization_id", "deal_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "evidence_items_organization_id_deal_id_evidence_type_idx" ON "evidence_items"("organization_id", "deal_id", "evidence_type");

-- CreateIndex
CREATE INDEX "evidence_items_organization_id_deal_id_connection_id_source_idx" ON "evidence_items"("organization_id", "deal_id", "connection_id", "source_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_items_organization_id_deal_id_id_key" ON "evidence_items"("organization_id", "deal_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_items_organization_id_deal_id_connection_id_source_key" ON "evidence_items"("organization_id", "deal_id", "connection_id", "source_record_id", "content_hash");

-- CreateIndex
CREATE INDEX "evidence_edges_organization_id_deal_id_to_evidence_id_idx" ON "evidence_edges"("organization_id", "deal_id", "to_evidence_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_edges_organization_id_deal_id_from_evidence_id_to__key" ON "evidence_edges"("organization_id", "deal_id", "from_evidence_id", "to_evidence_id", "edge_type");

-- CreateIndex
CREATE UNIQUE INDEX "citations_organization_id_deal_id_evidence_item_id_quote_ha_key" ON "citations"("organization_id", "deal_id", "evidence_item_id", "quote_hash");

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_organization_id_deal_id_connection_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "connection_id") REFERENCES "connections"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_organization_id_deal_id_connection_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "connection_id") REFERENCES "connections"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_organization_id_deal_id_first_sync_run_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "first_sync_run_id") REFERENCES "sync_runs"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_organization_id_deal_id_last_sync_run_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "last_sync_run_id") REFERENCES "sync_runs"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_edges" ADD CONSTRAINT "evidence_edges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_edges" ADD CONSTRAINT "evidence_edges_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_edges" ADD CONSTRAINT "evidence_edges_organization_id_deal_id_from_evidence_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "from_evidence_id") REFERENCES "evidence_items"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_edges" ADD CONSTRAINT "evidence_edges_organization_id_deal_id_to_evidence_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "to_evidence_id") REFERENCES "evidence_items"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_organization_id_deal_id_evidence_item_id_fkey" FOREIGN KEY ("organization_id", "deal_id", "evidence_item_id") REFERENCES "evidence_items"("organization_id", "deal_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Contributor boundary. Buyer side = an ACTIVE deal membership whose role is
-- not TARGET_CONTRIBUTOR. Fails closed: no membership means not buyer side.
-- Reads deal_memberships under the caller's own RLS (own rows are visible).
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_is_buyer_side(target_deal uuid) RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM deal_memberships m
       WHERE m.organization_id = app_current_organization_id()
         AND m.deal_id = target_deal
         AND m.user_id = app_current_user_id()
         AND m.status = 'ACTIVE'
         AND m.role <> 'TARGET_CONTRIBUTOR'
    )
  $$;
GRANT EXECUTE ON FUNCTION app_is_buyer_side(uuid) TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Privileges. Evidence is immutable apart from last-seen and sharing columns;
-- edges and citations are insert-only. No DELETE anywhere.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON connections, sync_runs TO pactlab_app;
GRANT SELECT, INSERT ON evidence_items, evidence_edges, citations TO pactlab_app;
GRANT UPDATE (last_sync_run_id, visibility, shared_by, shared_at) ON evidence_items TO pactlab_app;

ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_items FORCE ROW LEVEL SECURITY;
ALTER TABLE evidence_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_edges FORCE ROW LEVEL SECURITY;
ALTER TABLE citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE citations FORCE ROW LEVEL SECURITY;

CREATE POLICY connections_tenant ON connections FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
CREATE POLICY sync_runs_tenant ON sync_runs FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));

-- Evidence: tenant + deal scope, and buyer-only rows hidden from target contributors.
CREATE POLICY evidence_items_tenant ON evidence_items FOR ALL TO pactlab_app
  USING (
    organization_id = app_current_organization_id()
    AND deal_id = ANY (app_current_deal_ids())
    AND (visibility = 'SHARED' OR app_is_buyer_side(deal_id))
  )
  WITH CHECK (
    organization_id = app_current_organization_id()
    AND deal_id = ANY (app_current_deal_ids())
    AND (visibility = 'SHARED' OR app_is_buyer_side(deal_id))
  );

-- Edges and citations are visible only when their evidence is (the subquery
-- runs under evidence_items RLS), so lineage cannot leak buyer-only items.
CREATE POLICY evidence_edges_tenant ON evidence_edges FOR ALL TO pactlab_app
  USING (
    organization_id = app_current_organization_id()
    AND deal_id = ANY (app_current_deal_ids())
    AND EXISTS (SELECT 1 FROM evidence_items e WHERE e.id = evidence_edges.from_evidence_id)
    AND EXISTS (SELECT 1 FROM evidence_items e WHERE e.id = evidence_edges.to_evidence_id)
  )
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));
CREATE POLICY citations_tenant ON citations FOR ALL TO pactlab_app
  USING (
    organization_id = app_current_organization_id()
    AND deal_id = ANY (app_current_deal_ids())
    AND EXISTS (SELECT 1 FROM evidence_items e WHERE e.id = citations.evidence_item_id)
  )
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));

-- Live connections must reference a managed secret; fixture connections never do.
ALTER TABLE connections ADD CONSTRAINT connections_credential_matches_mode
  CHECK ((mode = 'LIVE') = (credential_ref IS NOT NULL));
-- Sharing is recorded with who and when.
ALTER TABLE evidence_items ADD CONSTRAINT evidence_items_shared_attribution
  CHECK ((visibility = 'SHARED') OR (shared_by IS NULL AND shared_at IS NULL));
