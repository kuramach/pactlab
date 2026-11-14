-- Organization brand kits (T-123, ADR 0031): the logo, colors and font an organization's
-- Pactlab wears, drafted from its website and reviewed by an admin. Presentation only.
-- Expand-only: a new table, one nullable column, one read-only function.
-- Rollback: drop app_public_brand, organization_brand_kits and organizations.website_url.

ALTER TABLE "organizations" ADD COLUMN "website_url" TEXT,
  ADD CONSTRAINT "organizations_website_url_check" CHECK ("website_url" IS NULL OR ("website_url" ~ '^https://' AND char_length("website_url") <= 500));
GRANT UPDATE ("website_url") ON organizations TO pactlab_app;

CREATE TABLE "organization_brand_kits" (
    "organization_id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'DEFAULT',
    "logo_object_key" TEXT,
    "logo_content_type" TEXT,
    "logo_width" INTEGER,
    "logo_height" INTEGER,
    "primary_color" TEXT,
    "accent_color" TEXT,
    "font" TEXT NOT NULL DEFAULT 'MANROPE',
    "draft" JSONB,
    "extraction" JSONB,
    "extracted_at" TIMESTAMPTZ(3),
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_brand_kits_pkey" PRIMARY KEY ("organization_id"),
    CONSTRAINT "organization_brand_kits_source_check" CHECK ("source" IN ('DEFAULT', 'EXTRACTED', 'EDITED')),
    CONSTRAINT "organization_brand_kits_font_check" CHECK ("font" IN ('MANROPE', 'INTER', 'SOURCE_SERIF')),
    CONSTRAINT "organization_brand_kits_logo_type_check" CHECK ("logo_content_type" IS NULL OR "logo_content_type" IN ('image/png', 'image/jpeg', 'image/svg+xml')),
    CONSTRAINT "organization_brand_kits_colors_check" CHECK (("primary_color" IS NULL OR "primary_color" ~ '^#[0-9a-f]{6}$') AND ("accent_color" IS NULL OR "accent_color" ~ '^#[0-9a-f]{6}$')),
    CONSTRAINT "organization_brand_kits_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Members read their organization's kit; owners and admins change it (checked again here).
ALTER TABLE organization_brand_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_brand_kits FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON organization_brand_kits TO pactlab_app;
CREATE POLICY organization_brand_kits_read ON organization_brand_kits FOR SELECT TO pactlab_app
  USING (organization_id = app_current_organization_id());
CREATE POLICY organization_brand_kits_insert ON organization_brand_kits FOR INSERT TO pactlab_app
  WITH CHECK (organization_id = app_current_organization_id() AND EXISTS (
    SELECT 1 FROM organization_memberships m WHERE m.organization_id = organization_brand_kits.organization_id AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE' AND m.role IN ('ORG_OWNER', 'ORG_ADMIN')));
CREATE POLICY organization_brand_kits_update ON organization_brand_kits FOR UPDATE TO pactlab_app
  USING (organization_id = app_current_organization_id() AND EXISTS (
    SELECT 1 FROM organization_memberships m WHERE m.organization_id = organization_brand_kits.organization_id AND m.user_id = app_current_user_id() AND m.status = 'ACTIVE' AND m.role IN ('ORG_OWNER', 'ORG_ADMIN')))
  WITH CHECK (organization_id = app_current_organization_id());

-- The organization's sign-in page (/login/<slug>) and its logo, before anyone is signed in:
-- presentation fields only, for an active organization that has a kit of its own.
GRANT SELECT ON organization_brand_kits TO pactlab_auth;
CREATE POLICY organization_brand_kits_public ON organization_brand_kits FOR SELECT TO pactlab_auth USING (true);
CREATE FUNCTION app_public_brand(p_slug text)
  RETURNS TABLE (organization_id uuid, name text, accent_color text, primary_color text, font text, logo_object_key text, logo_content_type text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT o.id, o.name, k.accent_color, k.primary_color, k.font, k.logo_object_key, k.logo_content_type
      FROM organizations o JOIN organization_brand_kits k ON k.organization_id = o.id
     WHERE o.slug = p_slug AND o.status = 'ACTIVE' AND k.source <> 'DEFAULT'
  $$;
ALTER FUNCTION app_public_brand(text) OWNER TO pactlab_auth;
REVOKE ALL ON FUNCTION app_public_brand(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_public_brand(text) TO pactlab_app;
