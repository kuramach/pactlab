-- T-066 commercial property pack import targets (ADR 0010). Expand only.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'CRE_RENT_ROLL';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'CRE_CAM_RECONCILIATION';
