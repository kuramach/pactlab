-- Proposals from connected AI apps (T-084b, ADR 0024): an MCP client with the mcp:propose scope
-- files a suggestion (a term on a finding, a document request, evidence); a person approves or
-- rejects it in the app, and approval runs the app's own service. Buyer side only: a counterparty
-- never sees or decides one. Grants may now hold the mcp:propose scope. Expand-only; rollback:
-- DROP TABLE agent_proposals, and restore oauth_grants_scopes from 20261129000000_mcp_oauth once no
-- grant holds mcp:propose.
-- Re-runnable: Prisma does not wrap a migration in one transaction.
BEGIN;

CREATE TABLE IF NOT EXISTS "agent_proposals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    -- The OAuth client that filed it, and the person whose token it was.
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL DEFAULT '',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    -- A friendly reason when approval could not be carried out (FAILED).
    "problem" TEXT,
    -- What approval created (a document request, a term batch).
    "result_ref" TEXT,
    CONSTRAINT "agent_proposals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_proposals_kind_check" CHECK ("kind" IN ('TERM', 'DOCUMENT_REQUEST', 'EVIDENCE')),
    CONSTRAINT "agent_proposals_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'FAILED', 'WITHDRAWN')),
    CONSTRAINT "agent_proposals_text_check" CHECK (char_length("rationale") <= 2000 AND char_length("client_id") <= 200 AND char_length("client_name") <= 200 AND ("decision_note" IS NULL OR char_length("decision_note") <= 2000) AND ("problem" IS NULL OR char_length("problem") <= 500)),
    CONSTRAINT "agent_proposals_deal_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "agent_proposals_org_deal_created_idx" ON "agent_proposals"("organization_id", "deal_id", "created_at");

GRANT SELECT, INSERT, UPDATE ON agent_proposals TO pactlab_app;
ALTER TABLE agent_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_proposals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_proposals_select ON agent_proposals;
CREATE POLICY agent_proposals_select ON agent_proposals FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));
DROP POLICY IF EXISTS agent_proposals_insert ON agent_proposals;
CREATE POLICY agent_proposals_insert ON agent_proposals FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id) AND created_by = app_current_user_id() AND status = 'PENDING');
DROP POLICY IF EXISTS agent_proposals_update ON agent_proposals;
CREATE POLICY agent_proposals_update ON agent_proposals FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_buyer_side(deal_id));

-- The scope that lets a connected app file suggestions (never decide them).
ALTER TABLE oauth_grants DROP CONSTRAINT IF EXISTS oauth_grants_scopes;
ALTER TABLE oauth_grants ADD CONSTRAINT oauth_grants_scopes CHECK (scopes <@ ARRAY['mcp:read', 'mcp:confidential', 'mcp:propose']::text[] AND cardinality(scopes) >= 1);

COMMIT;
