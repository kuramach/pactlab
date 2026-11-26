-- T-161 Small clinics pack: the few-site clinic variant of the healthcare pack (ADR 0052). Expand only.
-- Two CSV import targets (ADR 0010): collections and direct costs by service line and pseudonymous provider
-- (owner-operator dependence, service-line margin), and visits by referral source (referral concentration).
-- The premises are read from the lease document. No new table: every check is deterministic over imported
-- rows and quoted document pages; the T-160 healthcare targets are reused as they are.
-- Rollback: nothing to drop; the enum values stay (unused), as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'CLINICS_SERVICE_LINES';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'CLINICS_REFERRALS';
