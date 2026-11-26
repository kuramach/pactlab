-- T-163 Pharma & biotech pack: pipeline claims, patent cliffs and licence obligations, checked against
-- documents (ADR 0053). Expand only. Three CSV import targets (ADR 0010): the trial-registry records the
-- seller supplies (the pipeline's phase and timeline claims are checked against them), the seller's model
-- of payment obligations (milestones, royalties and fees, checked against the agreements) and the R&D
-- roster by pseudonymous reference (key-scientist concentration). No new table: every check is
-- deterministic over imported rows and quoted document pages.
-- Rollback: nothing to drop; the enum values stay (unused), as enum values cannot be dropped.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'PHARMA_TRIAL_REGISTRY';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'PHARMA_OBLIGATIONS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'PHARMA_RD_ROSTER';
