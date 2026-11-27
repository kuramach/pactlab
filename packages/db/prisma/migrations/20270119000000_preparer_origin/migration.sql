-- T-178b (ADR 0059): a Pactlab Rinse preparer's one-person workspace. On its own, because a new
-- enum value cannot be used in the transaction that adds it. Expand only; the value stays unused on rollback.
ALTER TYPE "organization_origin" ADD VALUE IF NOT EXISTS 'PREPARER';
