-- Batch 2. Expand-only.
--   1. A teaser's property: its address and the facts the seller approved from a property-data
--      lookup (RentCast in the US), each with its source. The public page shows the facts; the
--      address only on a NAMED teaser, so an anonymous teaser never gives the property away.
--   2. The demo organization's origin (ADR 0019 amendment): one synthetic organization per
--      environment, kept apart from real ones in operator views.
-- Rollback: drop the two columns; restore app_listing_public from 20261122000000.

ALTER TABLE "deal_listings"
  ADD COLUMN "property_address" TEXT,
  ADD COLUMN "property_facts" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT "deal_listings_property_check" CHECK (
    ("property_address" IS NULL OR length(btrim("property_address")) BETWEEN 5 AND 300)
    AND jsonb_typeof("property_facts") = 'array' AND jsonb_array_length("property_facts") <= 20);
GRANT SELECT ("property_address", "property_facts") ON deal_listings TO pactlab_public;

DROP FUNCTION app_listing_public(text);
CREATE FUNCTION app_listing_public(p_slug text)
  RETURNS TABLE (slug text, visibility text, codename text, public_name text, headline text, sector text, region text, size_band text,
                 asking_low text, asking_high text, asking_currency text, summary text, highlights text[], indexable boolean, published_at timestamptz,
                 property_address text, property_facts jsonb)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT l.slug, l.visibility, l.codename, CASE WHEN l.visibility = 'NAMED' THEN l.public_name END, l.headline, l.sector, l.region, l.size_band,
           l.asking_low::text, l.asking_high::text, l.asking_currency::text, l.summary, l.highlights, l.indexable, l.published_at::timestamptz,
           CASE WHEN l.visibility = 'NAMED' THEN l.property_address END, l.property_facts
      FROM deal_listings l
     WHERE l.slug = p_slug AND l.status = 'PUBLISHED';
$$;
ALTER FUNCTION app_listing_public(text) OWNER TO pactlab_public;
REVOKE ALL ON FUNCTION app_listing_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_listing_public(text) TO pactlab_app;

ALTER TYPE "organization_origin" ADD VALUE IF NOT EXISTS 'DEMO';
