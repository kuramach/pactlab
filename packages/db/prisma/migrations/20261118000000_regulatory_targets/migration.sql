-- T-091: footprint and divestiture-package imports for the regulatory screen.
-- Its own migration: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'REGULATORY_FOOTPRINT';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'REMEDY_PACKAGE';
