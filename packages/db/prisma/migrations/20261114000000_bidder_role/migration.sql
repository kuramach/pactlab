-- T-097 (ADR 0015): a bidder invited into a seller-led pact. Its own
-- migration: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "deal_role" ADD VALUE IF NOT EXISTS 'BIDDER';
