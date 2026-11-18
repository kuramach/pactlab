-- Consistency checks on agreements (T-132 PR 3): a document finding may be a drafting problem
-- (defined terms, cross-references, party names, contradictions). Expand-only; re-runnable.
-- Rollback: none needed (an unused enum value is harmless).
ALTER TYPE "document_finding_kind" ADD VALUE IF NOT EXISTS 'CONSISTENCY';
