-- A drive folder connected from the pact itself, by the deal team or the seller (Kumar, 2026-11-21:
-- "makes it easy to connect and view"). Expand only: new nullable or defaulted columns and extra
-- policies; the buyer-side policies are unchanged. Rollback: drop the two policies and the columns.

-- How a source signs in: a pasted access token (before T-147), or the person's own OAuth sign-in
-- (refresh tokens under credential_ref). Organization sign-ins keep organization_connection_id.
ALTER TABLE document_sources ADD COLUMN credential_kind text NULL CHECK (credential_kind IS NULL OR credential_kind IN ('TOKEN', 'OAUTH'));
ALTER TABLE document_sources NO FORCE ROW LEVEL SECURITY;
UPDATE document_sources SET credential_kind = 'TOKEN' WHERE credential_ref IS NOT NULL AND credential_kind IS NULL;
ALTER TABLE document_sources FORCE ROW LEVEL SECURITY;
-- Who it is signed in as (an email or sign-in name), shown on the pact; never a token.
ALTER TABLE document_sources ADD COLUMN account_name text NULL CHECK (account_name IS NULL OR length(account_name) <= 320);
-- Who sees what it reads: the seller's folder is shared with the deal; the deal team's is buyer-only.
ALTER TABLE document_sources ADD COLUMN visibility evidence_visibility NOT NULL DEFAULT 'BUYER_ONLY';

-- A seller (target contributor) reads, adds and updates only the sources they connected, always shared.
DROP POLICY IF EXISTS document_sources_contributor ON document_sources;
CREATE POLICY document_sources_contributor ON document_sources FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND created_by = app_current_user_id() AND visibility = 'SHARED')
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND created_by = app_current_user_id() AND visibility = 'SHARED');

-- A seller's sync marks replaced and removed files: only shared documents read from their own sources.
-- (The subquery runs under document_sources RLS, so it sees only the seller's own sources.)
DROP POLICY IF EXISTS documents_contributor_source_update ON documents;
CREATE POLICY documents_contributor_source_update ON documents FOR UPDATE TO pactlab_app
  USING (
    organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND visibility = 'SHARED'
    AND source_id IN (SELECT s.id FROM document_sources s WHERE s.created_by = app_current_user_id())
  )
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND visibility = 'SHARED');
