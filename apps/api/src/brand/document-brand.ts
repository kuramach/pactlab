import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { withTenant, type PrismaClient } from '@pactlab/db';
import { contrast, readableOnWhite, type BrandFont, type TenantContext } from '@pactlab/domain';
import { rgb, type RGB } from 'pdf-lib';
import type { DocumentObjectStore } from '../documents/documents.repository';

/**
 * The generating organization's brand on a document (T-123, ADR 0031), read once at generation:
 * a stored PDF keeps it, so a later rebrand never changes an old version. Null on the Pactlab kit.
 */
export interface DocumentBrand {
  readonly name: string;
  readonly accentColor: string | null;
  readonly primaryColor: string | null;
  readonly font: BrandFont;
  /** PNG or JPEG only: PDFs cannot carry an SVG, so an SVG-only kit prints the name as a wordmark. */
  readonly logo: { readonly bytes: Uint8Array; readonly type: 'image/png' | 'image/jpeg'; readonly sha256: string } | null;
}

export async function documentBrand(prisma: PrismaClient, store: DocumentObjectStore, tenant: TenantContext): Promise<DocumentBrand | null> {
  const [organization, kit] = await withTenant(prisma, tenant, (tx) =>
    Promise.all([
      tx.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true } }),
      tx.organizationBrandKit.findUnique({ where: { organizationId: tenant.organizationId } }),
    ]),
  );
  if (!organization || !kit || kit.source === 'DEFAULT') return null;
  let logo: DocumentBrand['logo'] = null;
  if (kit.logoObjectKey && (kit.logoContentType === 'image/png' || kit.logoContentType === 'image/jpeg')) {
    try {
      const bytes = await store.get(kit.logoObjectKey);
      logo = { bytes, type: kit.logoContentType, sha256: createHash('sha256').update(bytes).digest('hex') };
    } catch {
      // A missing logo object prints the wordmark; the document is still made.
    }
  }
  return { name: organization.name, accentColor: kit.accentColor, primaryColor: kit.primaryColor, font: kit.font as BrandFont, logo };
}

/** What a version records about the brand it was made with (lineage, not presentation). */
export function capturedBrand(brand: DocumentBrand | null): Record<string, unknown> {
  return brand
    ? { brand: { name: brand.name, accentColor: brand.accentColor, primaryColor: brand.primaryColor, font: brand.font, logoSha256: brand.logo?.sha256 ?? null } }
    : { brand: null };
}

const require = createRequire(import.meta.url);
const FONT_FILES: Readonly<Record<BrandFont, string>> = {
  MANROPE: '@fontsource/manrope/files/manrope-latin-{w}-normal.woff',
  INTER: '@fontsource/inter/files/inter-latin-{w}-normal.woff',
  SOURCE_SERIF: '@fontsource/source-serif-4/files/source-serif-4-latin-{w}-normal.woff',
};

/** The font files PDFs embed (all OFL): Manrope is Pactlab's; Inter and Source Serif are for kits. */
export function brandFontFile(font: BrandFont, weight: 400 | 600 | 700): Buffer {
  return readFileSync(require.resolve(FONT_FILES[font].replace('{w}', String(weight))));
}

export function hexToRgb(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

/** Heading ink and accent for a branded document: the kit's colors where they read on white. */
export function documentColors(brand: DocumentBrand | null, fallback: { ink: RGB; accent: RGB }): { ink: RGB; accent: RGB } {
  if (!brand) return fallback;
  const ink = brand.primaryColor && contrast(brand.primaryColor, '#ffffff') >= 4.5 ? hexToRgb(brand.primaryColor) : fallback.ink;
  const accent = brand.accentColor ? hexToRgb(readableOnWhite(brand.accentColor).color) : fallback.accent;
  return { ink, accent };
}

export const POWERED_BY = 'Powered by Pactlab';
