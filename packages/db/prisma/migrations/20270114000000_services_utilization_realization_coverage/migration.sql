-- T-167 IT & professional services pack: utilization, realization and the people the fees depend on (ADR 0055).
-- Expand only. Two CSV import targets (ADR 0010): the time-and-billing export (hours worked and billed, the
-- standard value of the time and the fees billed and collected, by month, client, engagement and
-- pseudonymous fee-earner) and the WIP and debtor ageing reports (balances by age band at each report date).
-- No new table: every check is deterministic over imported rows and quoted document pages.
-- Rollback: nothing to drop; the enum values stay (unused), as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'SERVICES_TIME_BILLING';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'SERVICES_AGEING';
