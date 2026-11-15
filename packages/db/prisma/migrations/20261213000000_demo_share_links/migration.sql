-- Shared demo links on demand (2026-11-15): an operator can open a live share's two links
-- again from the admin console. The links are kept sealed (AES-256-GCM, key held by the API,
-- never in the database); sign-in still matches only the hashes. An ended share's links are
-- never returned. Expand-only; rollback: drop the two columns and the two functions.
-- Re-runnable: Prisma does not wrap a migration in one transaction.
BEGIN;

ALTER TABLE demo_shares ADD COLUMN IF NOT EXISTS "buyer_link_sealed" TEXT;
ALTER TABLE demo_shares ADD COLUMN IF NOT EXISTS "seller_link_sealed" TEXT;

-- Keep a new share's sealed links (once, right after it is made).
CREATE OR REPLACE FUNCTION app_ops_demo_seal_links(p_actor uuid, p_share uuid, p_buyer text, p_seller text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM app_ops_require(p_actor);
  UPDATE demo_shares SET buyer_link_sealed = p_buyer, seller_link_sealed = p_seller
   WHERE id = p_share AND ended_at IS NULL AND buyer_link_sealed IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END
$$;

-- A live share's sealed links, audited; nothing for an ended or expired share.
CREATE OR REPLACE FUNCTION app_ops_demo_links(p_actor uuid, p_share uuid)
  RETURNS TABLE (shared_with text, ends_at timestamptz, buyer_link_sealed text, seller_link_sealed text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
#variable_conflict use_column
DECLARE
  v_org uuid;
BEGIN
  PERFORM app_ops_require(p_actor);
  SELECT s.organization_id INTO v_org FROM demo_shares s WHERE s.id = p_share AND s.ended_at IS NULL AND s.ends_at > now();
  IF v_org IS NULL THEN RETURN; END IF;
  PERFORM app_ops_audit(p_actor, v_org, 'demo.links_viewed', 'demo_share', p_share);
  RETURN QUERY SELECT s.shared_with, s.ends_at, s.buyer_link_sealed, s.seller_link_sealed FROM demo_shares s WHERE s.id = p_share;
END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['app_ops_demo_seal_links(uuid, uuid, text, text)', 'app_ops_demo_links(uuid, uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_ops', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;

COMMIT;
