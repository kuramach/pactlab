-- T-185 (ADR 0057 addendum): history of any length. deals.history_start_year is the year the business started, or
-- the property was built or acquired, or the earliest year the seller can provide. The years a pact expects (and asks
-- the seller for) run from max(latest − 4, history start) to the latest, so a business is never asked for years before
-- it existed. Set by the deal lead or an analyst on Finances, or prefilled from a pack field that holds it (year built);
-- every change is audited (`deal.history_start_set`). Buyer-side analysis input; RLS on deals as before.
-- Expand-only: a nullable column and its check; old code ignores both. Rollback: drop the column (and its check).

ALTER TABLE deals ADD COLUMN history_start_year integer;
ALTER TABLE deals ADD CONSTRAINT deals_history_start_year_check CHECK (history_start_year IS NULL OR history_start_year BETWEEN 1800 AND 2200);
