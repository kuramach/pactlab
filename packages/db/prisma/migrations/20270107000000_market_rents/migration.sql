-- T-158 (ADR 0045): market rents for a rent roll, from RentCast.
-- - deals.property_address: the property's address for a pact without a listing that names one. Asked once on the
--   screen, stored here and audited (`deal.property_address_set`). Buyer-side analysis input; RLS on deals as before.
-- - connections: a `rentcast` connection holds the pact's market-rent estimates (`market.rent_estimate` evidence). The
--   key is Pactlab's platform credential (pactlab/<env>/credentials/rentcast-api-key), never a tenant credential, so a
--   LIVE rentcast connection has no credential_ref, as file uploads have none. Widens the existing check.
-- Expand-only: a nullable column and a wider check; old code ignores both. Rollback: drop the column, delete any
-- rentcast connections' evidence first, then restore the previous check (20261024000000_fintech_pack).

ALTER TABLE deals ADD COLUMN property_address text;
ALTER TABLE deals ADD CONSTRAINT deals_property_address_check CHECK (property_address IS NULL OR length(property_address) BETWEEN 5 AND 200);

ALTER TABLE connections DROP CONSTRAINT connections_credential_matches_mode;
ALTER TABLE connections ADD CONSTRAINT connections_credential_matches_mode
  CHECK (
    (provider IN ('billing_upload', 'pack_upload', 'rentcast') AND credential_ref IS NULL AND (provider = 'rentcast' OR mode = 'LIVE'))
    OR (provider NOT IN ('billing_upload', 'pack_upload', 'rentcast') AND (mode = 'LIVE') = (credential_ref IS NOT NULL))
  );
