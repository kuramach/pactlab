-- T-057 pack framework (ADR 0009, ADR 0010). Expand-only.

-- The pack is the seller's company type: five ADR 0008 packs join the list.
ALTER TYPE "company_type" ADD VALUE IF NOT EXISTS 'MULTIFAMILY';
ALTER TYPE "company_type" ADD VALUE IF NOT EXISTS 'COMMERCIAL_PROPERTY';
ALTER TYPE "company_type" ADD VALUE IF NOT EXISTS 'HOTELS';
ALTER TYPE "company_type" ADD VALUE IF NOT EXISTS 'SMALL_CLINICS';
ALTER TYPE "company_type" ADD VALUE IF NOT EXISTS 'HOSPITALS';

-- Pack findings are not only technology findings.
ALTER TYPE "finding_domain" ADD VALUE IF NOT EXISTS 'FINANCIAL';
ALTER TYPE "finding_domain" ADD VALUE IF NOT EXISTS 'COMMERCIAL';
ALTER TYPE "finding_domain" ADD VALUE IF NOT EXISTS 'OPERATIONAL';
ALTER TYPE "finding_domain" ADD VALUE IF NOT EXISTS 'REGULATORY';
ALTER TYPE "finding_domain" ADD VALUE IF NOT EXISTS 'LEGAL';
ALTER TYPE "finding_domain" ADD VALUE IF NOT EXISTS 'PROPERTY';
ALTER TYPE "finding_domain" ADD VALUE IF NOT EXISTS 'PEOPLE';

-- A finding's evidence is a commit only when the evidence is code. The link
-- still requires evidence_item_id (citations stay mandatory), and the format
-- CHECK still applies whenever a commit is present (NULL passes a CHECK).
-- Rollback: restore NOT NULL only after removing rows with a NULL commit.
ALTER TABLE "finding_evidence_links" ALTER COLUMN "commit_sha" DROP NOT NULL;
