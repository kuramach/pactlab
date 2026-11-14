-- For a database that ran the first version of 20261204000000_investment_committee (T-118), whose
-- report-version backfill could not work outside tests: as the table owner (deployed databases do
-- not migrate as a superuser) FORCE row-level security hid every row, so nothing changed; with the
-- rows visible, the immutability trigger refused to touch finished versions, so the migration failed
-- (live, 2026-11-14). That migration now lifts both for its backfill; this one repairs a database
-- where the old one ran and changed nothing. Elsewhere it matches no rows.
--
-- Same rules as there. Only rows the backfill missed match: not own-side yet still in the shared
-- zero series, a state no correct write leaves (own-side versions are marked on insert, everyone
-- else's carry their own series). own_side when the generator holds a non-counterparty role on the
-- pact; otherwise the generator's own series, unless a newer version already holds that number.
-- RLS and the immutability trigger are lifted for this transaction only.
-- Rollback: none needed (data only, same values a superuser run would have written).

ALTER TABLE report_versions DISABLE TRIGGER report_versions_immutable;
ALTER TABLE report_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE deal_memberships NO FORCE ROW LEVEL SECURITY;

UPDATE report_versions r SET own_side = true
 WHERE r.deal_id IS NOT NULL AND NOT r.own_side AND r.series = '00000000-0000-0000-0000-000000000000'::uuid
   AND EXISTS (SELECT 1 FROM deal_memberships m WHERE m.deal_id = r.deal_id AND m.user_id = r.generated_by AND m.role::text NOT IN ('TARGET_CONTRIBUTOR', 'BIDDER'));

UPDATE report_versions r SET series = r.generated_by
 WHERE NOT r.own_side AND r.series = '00000000-0000-0000-0000-000000000000'::uuid
   AND NOT EXISTS (
     SELECT 1 FROM report_versions o
      WHERE o.organization_id = r.organization_id AND o.scope = r.scope AND o.deal_id IS NOT DISTINCT FROM r.deal_id
        AND o.series = r.generated_by AND o.version = r.version);

ALTER TABLE report_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE deal_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE report_versions ENABLE TRIGGER report_versions_immutable;
