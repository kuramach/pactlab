-- T-166 Hotels pack: franchise obligations and comp-set performance against the claims (ADR 0068). Expand only.
-- Three CSV import targets (ADR 0010): the agreements register (the franchise and management agreements' term,
-- fees and early-termination penalty), the brand's property improvement plan by item (cost and due date), and
-- the owner's capital expenditure budget by line (naming the PIP item each line funds). No new table: every
-- check is deterministic over imported rows and quoted document pages.
-- Rollback: nothing to drop; the enum values stay (unused), as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'HOTELS_AGREEMENTS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'HOTELS_PIP_SCHEDULE';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'HOTELS_CAPEX_BUDGET';
