import { asApp } from './auth-role';
import type { PrismaClient } from './client';

export interface PublicBrandRow {
  organizationId: string;
  name: string;
  accentColor: string | null;
  primaryColor: string | null;
  font: string;
  logoObjectKey: string | null;
  logoContentType: string | null;
}

/**
 * The sign-in page's brand (T-123): presentation fields of an active organization with a kit
 * of its own, by slug, through `app_public_brand` (pactlab_auth). Null when there is none.
 */
export async function publicBrand(prisma: PrismaClient, slug: string): Promise<PublicBrandRow | null> {
  const [row] = await asApp(prisma, (tx) =>
    tx.$queryRaw<{ organization_id: string; name: string; accent_color: string | null; primary_color: string | null; font: string; logo_object_key: string | null; logo_content_type: string | null }[]>`
      SELECT * FROM app_public_brand(${slug})`,
  );
  if (!row) return null;
  return {
    organizationId: row.organization_id,
    name: row.name,
    accentColor: row.accent_color,
    primaryColor: row.primary_color,
    font: row.font,
    logoObjectKey: row.logo_object_key,
    logoContentType: row.logo_content_type,
  };
}
