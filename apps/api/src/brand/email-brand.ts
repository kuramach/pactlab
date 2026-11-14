import type { EmailBrand } from '../email-login/email-sender';

/**
 * An organization's look on the emails sent for it (T-123). The logo is served by the
 * organization's public sign-in route, PNG or JPEG only (mail apps do not show SVG).
 * Null on the Pactlab kit.
 */
export function emailBrand(
  organization: { name: string; slug: string } | null,
  kit: { source: string; accentColor: string | null; logoContentType: string | null } | null,
  appOrigin: string,
): EmailBrand | null {
  if (!organization || !kit || kit.source === 'DEFAULT') return null;
  const raster = kit.logoContentType === 'image/png' || kit.logoContentType === 'image/jpeg';
  return { name: organization.name, accentColor: kit.accentColor, logoUrl: raster ? new URL(`/login/${organization.slug}/logo`, appOrigin).toString() : null };
}
