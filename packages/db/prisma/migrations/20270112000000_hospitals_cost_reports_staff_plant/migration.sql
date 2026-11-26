-- T-162 Hospitals pack: cost reports, payer contracts, plant and medical staff (ADR 0053). Expand only.
-- One CSV import target (ADR 0010): the medical-staff register at hospital scale — department, licence and
-- clinical privileges by pseudonymous staff reference. The cost report, payer agreements, property condition
-- assessment and quality reporting are read from documents; the plant and capex trend from the imported P&L.
-- No new table: every check is deterministic over imported rows and quoted document pages.
-- Rollback: nothing to drop; the enum value stays (unused), as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'HOSPITALS_MEDICAL_STAFF';
