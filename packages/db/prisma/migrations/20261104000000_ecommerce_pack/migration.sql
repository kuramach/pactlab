-- T-065 e-commerce and DTC pack import targets (ADR 0010). Expand only.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'ECOMMERCE_COHORTS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'ECOMMERCE_AD_SPEND';
