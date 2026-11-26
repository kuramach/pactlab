-- T-160 Healthcare services pack: multi-site provider diligence — payer mix, denials, credentialing (ADR 0051). Expand only.
-- Four CSV import targets (ADR 0010): remittances by month and payer, collections by clinician (pseudonymous
-- references), the credentialing register and the payer contract register. No new table: every check is
-- deterministic over imported rows and quoted document pages.
-- Rollback: nothing to drop; the enum values stay (unused), as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'HEALTHCARE_REMITTANCES';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'HEALTHCARE_CLINICIAN_COLLECTIONS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'HEALTHCARE_CREDENTIALS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'HEALTHCARE_PAYER_CONTRACTS';
