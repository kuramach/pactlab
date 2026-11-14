-- A logo drawn for a dark background (T-123): an all-white SVG disappears on white, so the app shows
-- it on a dark chip. Expand-only: one column with a default, and the public sign-in brand returns it.
-- One transaction, every statement safe to repeat. Rollback: restore app_public_brand from
-- 20261206000000_brand_kits and drop the column.
BEGIN;
ALTER TABLE "organization_brand_kits" ADD COLUMN IF NOT EXISTS "logo_light" BOOLEAN NOT NULL DEFAULT false;

-- The return type grows by one column, which needs a drop and a create (in this transaction, so no caller sees it missing).
DROP FUNCTION IF EXISTS app_public_brand(text);
CREATE FUNCTION app_public_brand(p_slug text)
  RETURNS TABLE (organization_id uuid, name text, accent_color text, primary_color text, font text, logo_object_key text, logo_content_type text, logo_light boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT o.id, o.name, k.accent_color, k.primary_color, k.font, k.logo_object_key, k.logo_content_type, k.logo_light
      FROM organizations o JOIN organization_brand_kits k ON k.organization_id = o.id
     WHERE o.slug = p_slug AND o.status = 'ACTIVE' AND k.source <> 'DEFAULT'
  $$;
ALTER FUNCTION app_public_brand(text) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_public_brand(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_public_brand(text) TO pactlab_app;
COMMIT;
