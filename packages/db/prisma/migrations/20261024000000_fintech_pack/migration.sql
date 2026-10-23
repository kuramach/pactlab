-- T-058 fintech pack, and the core gap it found: findings citing document pages.
-- Expand-only.

-- Fintech CSV import targets (ADR 0010).
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'FINTECH_LOAN_TAPE';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'FINTECH_AML_ALERT';

-- A finding may cite a document page by exact quote instead of an evidence
-- record (the allowance on a balance sheet, a clause in an agreement). The
-- quote is verified against the stored page text when recorded and again on
-- acceptance; exactly one of the two citation kinds is set.
ALTER TABLE "finding_evidence_links" ALTER COLUMN "evidence_item_id" DROP NOT NULL;
ALTER TABLE "finding_evidence_links" ADD COLUMN "document_citation" JSONB;
ALTER TABLE "finding_evidence_links" ADD CONSTRAINT "finding_evidence_links_one_citation"
  CHECK ((evidence_item_id IS NULL) <> (document_citation IS NULL));
-- Rollback: drop the constraint and column, and restore NOT NULL only after
-- removing links that cite a document.

-- Pack CSV uploads (ADR 0010) are file connections like billing uploads: LIVE,
-- with no credential. Widens the existing check (found by the fintech
-- acceptance test: T-057's pack upload path could not create its connection).
ALTER TABLE connections DROP CONSTRAINT connections_credential_matches_mode;
ALTER TABLE connections ADD CONSTRAINT connections_credential_matches_mode
  CHECK (
    (provider IN ('billing_upload', 'pack_upload') AND mode = 'LIVE' AND credential_ref IS NULL)
    OR (provider NOT IN ('billing_upload', 'pack_upload') AND (mode = 'LIVE') = (credential_ref IS NOT NULL))
  );
