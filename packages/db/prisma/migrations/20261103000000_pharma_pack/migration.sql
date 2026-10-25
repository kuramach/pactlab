-- T-064 pharma and biotech pack import targets (ADR 0010). Expand only.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'PHARMA_PATENTS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'PHARMA_PIPELINE';
