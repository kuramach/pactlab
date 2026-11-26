-- T-168 Telecom & media pack: subscriber claims, rights windows and revenue concentration (ADR 0056).
-- Expand only. Four CSV import targets (ADR 0010): subscriber movements from the billing or CRM system
-- (opening and closing subscribers, gross additions, disconnects and service revenue by month, region and
-- plan), the rights and carriage register (content, affiliate, carriage and sports-rights agreements with
-- their annual value and end dates), advertising and affiliate revenue by month and counterparty, and
-- capital expenditure by fiscal year and category.
-- No new table: every check is deterministic over imported rows and quoted document pages.
-- Rollback: nothing to drop; the enum values stay (unused), as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'TELECOM_SUBSCRIBER_MOVEMENTS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'TELECOM_AGREEMENTS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'TELECOM_REVENUE_STREAMS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'TELECOM_CAPEX';
