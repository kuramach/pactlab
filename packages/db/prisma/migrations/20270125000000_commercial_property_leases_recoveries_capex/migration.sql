-- T-165 Commercial property pack: rent roll against the leases, recoveries and expiry cliffs (ADR 0068). Expand only.
-- One CSV import target (ADR 0010): the seller's capital expenditure schedule by item, building element, amount and
-- status, read against the property condition assessment and, for committed lines, into the obligations the buyer
-- inherits. The rent roll and CAM reconciliation are the T-066 targets, unchanged; the leases are documents. No new
-- table: every check is deterministic over imported rows and quoted document pages.
-- Rollback: nothing to drop; the enum value stays (unused), as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'CRE_CAPEX_SCHEDULE';
