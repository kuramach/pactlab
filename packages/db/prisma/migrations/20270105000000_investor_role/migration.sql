-- T-141 (ADR 0044): an investor seated in a pooled vehicle, and the Startup equity SPV pack.
-- Its own migration: a new enum value cannot be used in the transaction that adds it.
-- Rollback: none needed; the values stay (unused) as enum values cannot be dropped.
ALTER TYPE "deal_role" ADD VALUE IF NOT EXISTS 'INVESTOR';
ALTER TYPE "company_type" ADD VALUE IF NOT EXISTS 'STARTUP_SPV';
