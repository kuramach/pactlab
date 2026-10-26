-- T-069 hospitals pack import targets (ADR 0010). Expand only.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'HOSPITALS_CENSUS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'HOSPITALS_PAYER_MIX';
