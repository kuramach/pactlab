import type { BrandKitView } from '@pactlab/contracts';
import { describe, expect, it } from 'vitest';
import { appBrand, themeCss } from './brand';

const kit = (over: Partial<BrandKitView>): BrandKitView => ({
  organizationName: 'Acme Capital',
  slug: 'acme',
  websiteUrl: null,
  source: 'EDITED',
  hasLogo: true,
  logoContentType: 'image/png',
  version: 'k1',
  primaryColor: null,
  accentColor: '#0b5fff',
  accentReadable: '#0b5fff',
  accentAdjusted: false,
  font: 'INTER',
  draft: null,
  extracting: false,
  canEdit: true,
  ...over,
});

describe('the app brand (T-123)', () => {
  it('is Pactlab for an organization without a kit of its own', () => {
    expect(appBrand(null)).toBeNull();
    expect(appBrand(kit({ source: 'DEFAULT' }))).toBeNull();
  });

  it('themes the accent and font, with the logo behind a versioned URL', () => {
    const brand = appBrand(kit({}));
    expect(brand?.logoUrl).toBe('/brand-logo?v=k1');
    const css = themeCss(brand?.variables ?? null) ?? '';
    expect(css).toMatch(/^:root\{--color-indigo:#[0-9a-f]{6};/);
    expect(css).toContain('--font-sans:var(--font-inter)');
    expect(appBrand(kit({ hasLogo: false }))?.logoUrl).toBeNull();
  });

  it('never writes anything but variables and safe values into the style', () => {
    expect(themeCss({ '--color-indigo': 'red;}</style><script>', 'color': '#fff' })).toBeNull();
    expect(themeCss(null)).toBeNull();
  });
});
