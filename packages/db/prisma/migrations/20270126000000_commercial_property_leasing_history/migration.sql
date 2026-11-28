-- T-184c Five years of history for commercial property (ADR 0057). Expand only.
-- One CSV import target (ADR 0010): leasing history by month (rentable and leased area, base rent in force and the
-- area whose leases ended), read by calendar year beside the P&L as occupancy, rent per square foot and lease
-- expiries. No new table: the history is computed from imported rows.
-- Rollback: nothing to drop; the enum value stays (unused), as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'CRE_LEASING_HISTORY';
