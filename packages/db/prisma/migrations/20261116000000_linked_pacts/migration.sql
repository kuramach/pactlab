-- T-097 (ADR 0015, decided by Kumar 2026-10-28): after the seller awards a
-- bid, the winner does their own diligence in a **linked buyer-led pact in
-- their own organization** — never inside the seller's pact, where their
-- analysis would be visible to the seller's side.
--
-- Expand only. Rollback: drop the function, policy, grant, index and columns.

-- The sale a buyer-led pact came from (another organization's pact): a
-- reference only, never a join path — no foreign key across organizations.
ALTER TABLE deals ADD COLUMN linked_organization_id uuid, ADD COLUMN linked_deal_id uuid;
ALTER TABLE deals ADD CONSTRAINT deals_linked_check CHECK ((linked_organization_id IS NULL) = (linked_deal_id IS NULL));
CREATE UNIQUE INDEX deals_linked_sale_key ON deals (organization_id, linked_organization_id, linked_deal_id) WHERE linked_deal_id IS NOT NULL;

-- Did the caller win that sale? True only for an active bidder membership on
-- the pact whose bid is WON. Security definer (owned by the auth role) so it
-- can be asked from the caller's own organization; it answers only about the caller.
GRANT SELECT ON bids TO pactlab_auth;
CREATE POLICY bids_auth_select ON bids FOR SELECT TO pactlab_auth USING (true);
CREATE FUNCTION app_won_sale(p_organization uuid, p_deal uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM deal_memberships m
        JOIN bids b ON b.organization_id = m.organization_id AND b.deal_id = m.deal_id AND b.id = m.bid_id
       WHERE m.organization_id = p_organization AND m.deal_id = p_deal
         AND m.user_id = app_current_user_id() AND m.role = 'BIDDER' AND m.status = 'ACTIVE'
         AND b.status = 'WON'
    )
  $$;
ALTER FUNCTION app_won_sale(uuid, uuid) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_won_sale(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_won_sale(uuid, uuid) TO pactlab_app;
