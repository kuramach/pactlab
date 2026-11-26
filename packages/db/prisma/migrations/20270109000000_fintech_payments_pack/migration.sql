-- T-159 Fintech pack: payments and lending economics checked against processor and licence evidence (ADR 0050). Expand only.
-- Two CSV import targets (ADR 0010): the processor or bank settlement export (volume, transactions,
-- net revenue, chargebacks and fraud losses by month and processor) and the licence and sponsor
-- register. No new table: every check is deterministic over imported rows and quoted document pages.
-- Rollback: nothing to drop; the enum values stay (unused), as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'FINTECH_PROCESSOR_VOLUME';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'FINTECH_LICENCES';
