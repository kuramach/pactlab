-- T-154 (ADR 0039): a withdrawn import. Its own migration: a new enum value
-- cannot be used in the transaction that adds it.
ALTER TYPE "source_upload_status" ADD VALUE IF NOT EXISTS 'WITHDRAWN';
