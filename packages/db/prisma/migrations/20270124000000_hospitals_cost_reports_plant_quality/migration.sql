-- T-162 Hospitals pack: cost reports, payer contracts, plant and medical staff (ADR 0067). Expand only.
-- Two CSV import targets (ADR 0010): the filed cost reports' statistics and costs by fiscal year (reconciled
-- against the deck and the financial statements), and capital expenditure by fiscal year (the plant's capex
-- trend against the imported P&L). The medical-staff and payer-contract registers are the T-160 healthcare
-- targets, reused as they are (each gains an optional column in code only). No new table: every check is
-- deterministic over imported rows and quoted document pages.
-- Rollback: nothing to drop; the enum values stay (unused), as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'HOSPITALS_COST_REPORT';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'HOSPITALS_CAPEX';
