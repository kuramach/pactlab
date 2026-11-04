-- Pictures and video links on a public deal page. Expand-only: one table and two public
-- functions. Images live in the document object store (key below); videos are a provider
-- and an id, never a pasted URL. Rollback: drop the functions and the table (and the objects).
CREATE TABLE "listing_media" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "caption" TEXT,
    "object_key" TEXT,
    "content_type" TEXT,
    "sha256" TEXT,
    "byte_size" INTEGER,
    "video_provider" TEXT,
    "video_id" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_media_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "listing_media_kind_check" CHECK (
      ("kind" = 'IMAGE' AND "object_key" IS NOT NULL AND "content_type" IN ('image/jpeg', 'image/png', 'image/webp')
         AND "sha256" ~ '^[0-9a-f]{64}$' AND "byte_size" BETWEEN 1 AND 5242880 AND "video_provider" IS NULL AND "video_id" IS NULL)
      OR ("kind" = 'VIDEO' AND "object_key" IS NULL AND "content_type" IS NULL AND "sha256" IS NULL AND "byte_size" IS NULL
         AND (("video_provider" = 'YOUTUBE' AND "video_id" ~ '^[A-Za-z0-9_-]{11}$') OR ("video_provider" = 'VIMEO' AND "video_id" ~ '^[0-9]{1,12}$')))),
    CONSTRAINT "listing_media_caption_check" CHECK ("caption" IS NULL OR length("caption") <= 200),
    CONSTRAINT "listing_media_position_check" CHECK ("position" >= 0)
);
CREATE INDEX "listing_media_listing_idx" ON "listing_media"("listing_id", "position");
ALTER TABLE "listing_media" ADD CONSTRAINT "listing_media_listing_fkey" FOREIGN KEY ("organization_id", "deal_id", "listing_id") REFERENCES "deal_listings"("organization_id", "deal_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The seller's side only (like the listing itself).
GRANT SELECT, INSERT, UPDATE, DELETE ON listing_media TO pactlab_app;
ALTER TABLE listing_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_media FORCE ROW LEVEL SECURITY;
CREATE POLICY listing_media_own_side ON listing_media FOR ALL TO pactlab_app
  USING (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id))
  WITH CHECK (organization_id = app_current_organization_id() AND deal_id = ANY (app_current_deal_ids()) AND app_is_own_side(deal_id));

-- Signed-out visitors: a published page's media, through the functions below only.
GRANT SELECT (id, listing_id, kind, position, caption, object_key, content_type, video_provider, video_id) ON listing_media TO pactlab_public;
CREATE POLICY listing_media_public ON listing_media FOR SELECT TO pactlab_public
  USING (listing_id IN (SELECT l.id FROM deal_listings l WHERE l.status = 'PUBLISHED'));

-- A published page's media, in order. Never the storage key.
CREATE FUNCTION app_listing_media(p_slug text)
  RETURNS TABLE (id uuid, kind text, caption text, content_type text, video_provider text, video_id text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT m.id, m.kind, m.caption, m.content_type, m.video_provider, m.video_id
      FROM listing_media m JOIN deal_listings l ON l.id = m.listing_id
     WHERE l.slug = p_slug AND l.status = 'PUBLISHED'
     ORDER BY m.position, m.id;
$$;

-- One image of a published page: where it is stored, so the API can stream it.
CREATE FUNCTION app_listing_image(p_slug text, p_media_id uuid)
  RETURNS TABLE (object_key text, content_type text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT m.object_key, m.content_type
      FROM listing_media m JOIN deal_listings l ON l.id = m.listing_id
     WHERE l.slug = p_slug AND l.status = 'PUBLISHED' AND m.id = p_media_id AND m.kind = 'IMAGE';
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['app_listing_media(text)', 'app_listing_image(text, uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO pactlab_public', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pactlab_app', fn);
  END LOOP;
END
$$;
