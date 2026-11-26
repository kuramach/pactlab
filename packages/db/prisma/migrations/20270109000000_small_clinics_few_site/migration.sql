-- T-161 small clinics, the few-site variant (ADR 0050). Expand only.
-- Two CSV import targets (ADR 0010): visits and collections by month, service line, pseudonymous
-- provider (with the provider's role: the selling owner or not) and referral source; and revenue and
-- direct costs by service line and fiscal year. No new table: the rows are evidence like every import.
-- Rollback: nothing to undo; the enum values stay (unused) as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'CLINICS_VISITS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'CLINICS_SERVICE_LINES';
