-- Valuation direction on findings: drag (-1) reprices, cushion (+1) confirms, neutral (0) is a
-- recorded decision. Expand-only: new nullable columns; existing rows stay "not yet decided".

-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "direction" SMALLINT,
ADD COLUMN     "direction_rationale" TEXT,
ADD COLUMN     "value_basis" TEXT,
ADD COLUMN     "value_currency" CHAR(3),
ADD COLUMN     "value_driver" TEXT,
ADD COLUMN     "value_high" DECIMAL(19,4),
ADD COLUMN     "value_low" DECIMAL(19,4);

-- AlterTable
ALTER TABLE "finding_reviews" ADD COLUMN     "direction" SMALLINT,
ADD COLUMN     "direction_rationale" TEXT;



-- ---------------------------------------------------------------------------
-- Integrity. Money belongs to one direction: a priced risk to a drag (or an
-- undecided finding), a value confirmation to a cushion, nothing to neutral.
-- An accepted finding with a direction satisfies that direction's rule; rows
-- accepted before directions existed keep direction NULL and still pass.
-- There is no price-increase adjustment, and no column can hold one.
-- ---------------------------------------------------------------------------
ALTER TABLE findings ADD CONSTRAINT findings_direction
  CHECK (
    (direction IS NULL OR direction IN (-1, 0, 1))
    AND ((value_driver IS NULL) = (value_basis IS NULL))
    AND ((value_low IS NULL) = (value_high IS NULL) AND (value_low IS NULL) = (value_currency IS NULL))
    AND (value_low IS NULL OR (value_driver IS NOT NULL AND value_low >= 0 AND value_low <= value_high AND value_currency ~ '^[A-Z]{3}$'))
    AND (value_driver IS NULL OR direction = 1)
    AND (priced_risk_type IS NULL OR direction IS NULL OR direction = -1)
    AND (direction_rationale IS NULL OR length(direction_rationale) <= 4000)
    AND (
      status <> 'ACCEPTED' OR direction IS NULL
      OR (direction = -1 AND priced_risk_type IS NOT NULL)
      OR (direction = 1 AND value_driver IS NOT NULL)
      OR (direction = 0 AND direction_rationale IS NOT NULL)
    )
  );

ALTER TABLE finding_reviews ADD CONSTRAINT finding_reviews_direction
  CHECK (
    (direction IS NULL OR direction IN (-1, 0, 1))
    AND (direction IS NULL OR decision = 'ACCEPTED')
    AND (direction_rationale IS NULL OR direction IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- Privileges. The new finding columns change through the same reviewed
-- workflow as the priced risk; reviews stay insert-only.
-- ---------------------------------------------------------------------------
GRANT UPDATE (direction, value_driver, value_basis, value_low, value_high, value_currency, direction_rationale)
  ON findings TO pactlab_app;
