-- Engineering people: the gated contributor directory and the per-deal names gate.
-- Expand-only; no existing object changes.

-- CreateEnum
CREATE TYPE "contributor_status" AS ENUM ('CURRENT', 'DEPARTED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "contributor_identities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "contributor_key" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "display_name" TEXT,
    "status" "contributor_status" NOT NULL DEFAULT 'UNKNOWN',
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contributor_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people_access" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "basis" TEXT NOT NULL,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "people_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contributor_identities_organization_id_deal_id_contributor__idx" ON "contributor_identities"("organization_id", "deal_id", "contributor_key");

-- CreateIndex
CREATE UNIQUE INDEX "contributor_identities_organization_id_deal_id_system_ident_key" ON "contributor_identities"("organization_id", "deal_id", "system", "identity");

-- CreateIndex
CREATE INDEX "people_access_organization_id_deal_id_decided_at_idx" ON "people_access"("organization_id", "deal_id", "decided_at");

-- AddForeignKey
ALTER TABLE "contributor_identities" ADD CONSTRAINT "contributor_identities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributor_identities" ADD CONSTRAINT "contributor_identities_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_access" ADD CONSTRAINT "people_access_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_access" ADD CONSTRAINT "people_access_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Integrity.
-- ---------------------------------------------------------------------------
ALTER TABLE contributor_identities ADD CONSTRAINT contributor_identities_values
  CHECK (
    system IN ('github', 'jira')
    AND contributor_key ~ '^[0-9a-f]{16}$'
    AND length(identity) BETWEEN 1 AND 320
    AND (display_name IS NULL OR length(display_name) <= 200)
  );
ALTER TABLE people_access ADD CONSTRAINT people_access_values
  CHECK (length(trim(basis)) BETWEEN 10 AND 1000);

-- ---------------------------------------------------------------------------
-- Privileges. The directory is kept current by sync (insert, refresh name,
-- status and last seen); nothing is deleted. The names gate is append-only.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON contributor_identities TO pactlab_app;
GRANT UPDATE (display_name, status, last_seen_at) ON contributor_identities TO pactlab_app;
GRANT SELECT, INSERT ON people_access TO pactlab_app;

-- ---------------------------------------------------------------------------
-- Row-level security. People data is buyer-side analysis; target
-- contributors never see it. Only a deal lead opens or closes the names gate.
-- ---------------------------------------------------------------------------
ALTER TABLE contributor_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributor_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE people_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE people_access FORCE ROW LEVEL SECURITY;

CREATE POLICY contributor_identities_select ON contributor_identities FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY contributor_identities_insert ON contributor_identities FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY contributor_identities_update ON contributor_identities FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()));

CREATE POLICY people_access_select ON people_access FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
CREATE POLICY people_access_insert ON people_access FOR INSERT TO pactlab_app
  WITH CHECK (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids())
    AND decided_by = app_current_user_id()
    AND EXISTS (
      SELECT 1 FROM deal_memberships m
       WHERE m.organization_id = people_access.organization_id AND m.deal_id = people_access.deal_id
         AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE' AND m.role = 'DEAL_LEAD'
    )
  );
