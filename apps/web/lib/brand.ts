import type { BrandKitView, PublicBrandView } from '@pactlab/contracts';
import { brandThemeVariables } from '@pactlab/domain';
import { publicEnv } from './env';

/**
 * Organization brand kits in the app (T-123, ADR 0031): theme variables, the logo URL and the
 * sign-in page's brand. Presentation only; the API decides who sees what.
 */
export type ThemeVariables = Record<string, string>;

/** The variables as one CSS rule. Every value comes from `brandThemeVariables`: hex colors and fixed font stacks. */
export function themeCss(variables: ThemeVariables | null, selector = ':root'): string | null {
  if (!variables) return null;
  const body = Object.entries(variables)
    .filter(([name, value]) => /^--[a-z-]+$/.test(name) && /^[#a-z0-9(),\s-]+$/i.test(value))
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
  return body ? `${selector}{${body}}` : null;
}

/** The app's brand for the signed-in organization: null on the Pactlab kit. */
export function appBrand(kit: BrandKitView | null): { name: string; logoUrl: string | null; variables: ThemeVariables | null } | null {
  if (!kit || kit.source === 'DEFAULT') return null;
  return {
    name: kit.organizationName,
    // The version in the URL changes when the logo does, so a cached old logo is never shown.
    logoUrl: kit.hasLogo ? `/brand-logo?v=${encodeURIComponent(kit.version)}` : null,
    variables: brandThemeVariables({ accentColor: kit.accentColor, font: kit.font }),
  };
}

export async function fetchPublicBrand(slug: string): Promise<PublicBrandView | null> {
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) return null;
  try {
    const response = await fetch(new URL(`/v1/brand/${slug}`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { cache: 'no-store' });
    return response.ok ? ((await response.json()) as PublicBrandView) : null;
  } catch {
    return null;
  }
}

/** The headers every brand logo is served with: an image and nothing else. */
export const LOGO_HEADERS = {
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'x-content-type-options': 'nosniff',
} as const;

export const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);

/** "Not now" on the Home page's website ask, per browser. */
export const BRAND_PROMPT_COOKIE = 'pactlab_brand_prompt';
