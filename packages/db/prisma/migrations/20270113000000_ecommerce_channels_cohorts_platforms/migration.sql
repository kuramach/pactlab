-- T-164 E-commerce & DTC pack: channel economics, cohort value and platform dependence (ADR 0054).
-- Expand only. Two CSV import targets (ADR 0010): orders by month, channel and platform account from the
-- storefront and marketplace exports (revenue by channel, contribution margin, returns, new customers and
-- the account each order ran through) and the stock report (inventory ageing). No new table: every check
-- is deterministic over imported rows and quoted document pages.
-- Rollback: nothing to drop; the enum values stay (unused), as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'ECOMMERCE_CHANNEL_ORDERS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'ECOMMERCE_INVENTORY';
