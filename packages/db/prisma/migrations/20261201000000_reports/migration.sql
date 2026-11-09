-- Reports (T-110): versioned PDF snapshots. An executive report across the organization's pacts,
-- or a detailed report on one pact. Expand-only: one new table. Each version is immutable once
-- READY: its bytes are stored once under their own key and never rewritten. The only later change
-- is PURGED, when the pact it reports on is deleted (the PDF holds that pact's data).

CREATE TABLE "report_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "deal_id" UUID,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATING',
    "generated_by" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_as_of" TIMESTAMPTZ(3) NOT NULL,
    "captured" JSONB NOT NULL DEFAULT '{}',
    "object_key" TEXT,
    "sha256" CHAR(64),
    "byte_size" INTEGER,
    CONSTRAINT "report_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "report_versions_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "report_versions_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "report_versions_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "report_versions_scope" CHECK (("scope" = 'EXECUTIVE' AND "deal_id" IS NULL) OR ("scope" = 'PACT' AND "deal_id" IS NOT NULL)),
    CONSTRAINT "report_versions_status" CHECK ("status" IN ('GENERATING', 'READY', 'FAILED', 'PURGED')),
    CONSTRAINT "report_versions_ready" CHECK ("status" <> 'READY' OR ("object_key" IS NOT NULL AND "sha256" IS NOT NULL AND "byte_size" > 0)),
    CONSTRAINT "report_versions_version" CHECK ("version" >= 1)
);
-- One version number per scope: the organization's executive reports, and each pact's reports.
CREATE UNIQUE INDEX "report_versions_scope_version_key" ON "report_versions"("organization_id", "scope", COALESCE("deal_id", '00000000-0000-0000-0000-000000000000'::uuid), "version");
CREATE INDEX "report_versions_history_idx" ON "report_versions"("organization_id", "scope", "deal_id", "version" DESC);

-- Immutability: a READY or FAILED version never changes, except READY -> PURGED (key removed) when its pact is deleted.
CREATE FUNCTION report_versions_immutable() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'report versions are never deleted' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'GENERATING' THEN
    IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.scope <> OLD.scope OR NEW.deal_id IS DISTINCT FROM OLD.deal_id
       OR NEW.version <> OLD.version OR NEW.generated_by <> OLD.generated_by OR NEW.generated_at <> OLD.generated_at OR NEW.data_as_of <> OLD.data_as_of THEN
      RAISE EXCEPTION 'a report version''s identity never changes' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'READY' AND NEW.status = 'PURGED' AND NEW.object_key IS NULL
     AND (NEW.id, NEW.version, NEW.sha256, NEW.byte_size) = (OLD.id, OLD.version, OLD.sha256, OLD.byte_size) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'report version % is final', OLD.id USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER report_versions_immutable BEFORE UPDATE OR DELETE ON report_versions FOR EACH ROW EXECUTE FUNCTION report_versions_immutable();

-- Tenancy: an organization's own versions; a pact's versions only for those on the pact.
ALTER TABLE report_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_versions FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON report_versions TO pactlab_app;
GRANT UPDATE ("status", "captured", "object_key", "sha256", "byte_size") ON report_versions TO pactlab_app;
CREATE POLICY report_versions_tenant ON report_versions FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND (deal_id IS NULL OR deal_id = ANY (app_current_deal_ids())))
  WITH CHECK (organization_id = app_current_organization_id() AND (deal_id IS NULL OR deal_id = ANY (app_current_deal_ids())));
