-- Which demo build each demo organization was made from (T-124): the sweep rebuilds a demo whose
-- build is older than the deployed one (idle slots at once; shared ones when their share ends; the
-- main demo organization too), so a demo never lags the release. Operator data only: no app access.
-- One transaction, every statement safe to repeat. Rollback: drop the table.
BEGIN;
CREATE TABLE IF NOT EXISTS "demo_builds" (
    "organization_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "built_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "demo_builds_pkey" PRIMARY KEY ("organization_id"),
    CONSTRAINT "demo_builds_version_check" CHECK (char_length("version") BETWEEN 1 AND 64),
    CONSTRAINT "demo_builds_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE demo_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_builds FORCE ROW LEVEL SECURITY;
GRANT SELECT ON demo_builds TO pactlab_ops;
DROP POLICY IF EXISTS demo_builds_ops ON demo_builds;
CREATE POLICY demo_builds_ops ON demo_builds FOR SELECT TO pactlab_ops USING (true);
COMMIT;
