-- T-165 Commercial property pack: the rent roll against the leases, recoveries and expiry cliffs (ADR 0055).
-- Expand only. One CSV import target (ADR 0010): the seller's capex schedule (projects by year, planned,
-- committed or completed), against which property-condition and environmental items are checked and from
-- which committed capex joins the obligations register. No new table: every check is deterministic over
-- imported rows (the rent roll, the CAM reconciliation, the capex schedule, the P&L by year) and quoted pages
-- of the leases and reports.
-- Rollback: nothing to drop; the enum value stays (unused), as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'CRE_CAPEX_SCHEDULE';
