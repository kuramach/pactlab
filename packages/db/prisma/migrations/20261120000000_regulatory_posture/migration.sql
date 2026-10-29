-- T-091 Part 1: posture signals — the enforcement climate as dated, cited
-- entries. One record, read by the regulatory screen and by Foresight's
-- government-posture trend. Widens the kind check only; existing rows are
-- untouched. Rollback: restore the previous check (after removing any
-- POSTURE rows).
ALTER TABLE "regulatory_entries" DROP CONSTRAINT "regulatory_entries_kind_check";
ALTER TABLE "regulatory_entries" ADD CONSTRAINT "regulatory_entries_kind_check" CHECK ("kind" IN ('TERMS', 'BUYER', 'FEEDBACK', 'REVISION', 'COMMITMENT', 'POSTURE'));
