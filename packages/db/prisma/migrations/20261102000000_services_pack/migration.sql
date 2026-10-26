-- T-063 professional services pack import targets (ADR 0010). Expand only.
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'SERVICES_TIMESHEETS';
ALTER TYPE "import_target" ADD VALUE IF NOT EXISTS 'SERVICES_HEADCOUNT';
