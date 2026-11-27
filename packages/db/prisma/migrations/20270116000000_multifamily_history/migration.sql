-- T-183 Five years of history, built on multifamily (ADR 0057).
-- Expand only. Two CSV import targets (ADR 0010): occupancy and rent by month or year (units, occupied
-- units, average in-place rent and concessions, overall or by unit type), and rent-roll snapshots (each
-- row a unit at an as-of date). The P&L by year stays the core FINANCIAL_PNL import.
-- No new table: the history calculator and its checks are deterministic over imported rows.
-- Rollback: nothing to drop; the enum values stay (unused), as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'MULTIFAMILY_OCCUPANCY';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'MULTIFAMILY_RENT_ROLL_HISTORY';
