/** An organization's brand kit (T-123, ADR 0031). Presentation only. */
export type BrandFontView = 'MANROPE' | 'INTER' | 'SOURCE_SERIF';
export type BrandSourceView = 'DEFAULT' | 'EXTRACTED' | 'EDITED';

export interface BrandDraftView {
  websiteUrl: string;
  hasLogo: boolean;
  logoFrom: string | null;
  accentColor: string | null;
  primaryColor: string | null;
  font: BrandFontView;
  notes: readonly string[];
  extractedAt: string;
}

export interface BrandKitView {
  organizationName: string;
  slug: string;
  websiteUrl: string | null;
  source: BrandSourceView;
  hasLogo: boolean;
  logoContentType: string | null;
  /** Changes whenever the kit does: a cache key for the logo. */
  version: string;
  primaryColor: string | null;
  accentColor: string | null;
  /** The accent as used for text and buttons: adjusted to 4.5:1 on white when it fails. */
  accentReadable: string | null;
  accentAdjusted: boolean;
  font: BrandFontView;
  draft: BrandDraftView | null;
  extracting: boolean;
  canEdit: boolean;
}

/** The sign-in page's brand: nothing beyond what the page shows. */
export interface PublicBrandView {
  name: string;
  accentColor: string | null;
  accentReadable: string | null;
  primaryColor: string | null;
  font: BrandFontView;
  hasLogo: boolean;
}
