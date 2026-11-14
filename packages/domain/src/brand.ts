/**
 * Organization brand kits (T-123, ADR 0031): the logo, colors and font a firm's Pactlab wears.
 * Presentation only. Shared by the web (theme) and the API (extraction, documents, emails).
 */
export const BRAND_FONTS = ['MANROPE', 'INTER', 'SOURCE_SERIF'] as const;
export type BrandFont = (typeof BRAND_FONTS)[number];

export const BRAND_FONT_LABELS: Readonly<Record<BrandFont, string>> = { MANROPE: 'Manrope', INTER: 'Inter', SOURCE_SERIF: 'Source Serif' };

/** Pactlab's own kit: every surface falls back to it. */
export const PACTLAB_BRAND = { primaryColor: '#081127', accentColor: '#6978ff', font: 'MANROPE' as BrandFont };

const HEX = /^#([0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The accent as text and links on white must reach WCAG AA (4.5:1). A failing color is darkened
 * step by step (keeping its hue) until it passes; the original is kept for fills and large type.
 */
export function readableOnWhite(hex: string): { color: string; adjusted: boolean } {
  if (!isHexColor(hex)) return { color: PACTLAB_BRAND.accentColor, adjusted: true };
  let color = hex.toLowerCase();
  if (contrast(color, '#ffffff') >= 4.5) return { color, adjusted: false };
  let [r, g, b] = rgb(color);
  for (let step = 0; step < 40 && contrast(color, '#ffffff') < 4.5; step += 1) {
    [r, g, b] = [r * 0.94, g * 0.94, b * 0.94];
    color = toHex([r, g, b]);
  }
  return { color, adjusted: true };
}

/** Text that reads on a fill of this color: navy or white, whichever contrasts more. */
export function textOn(hex: string): '#081127' | '#ffffff' {
  if (!isHexColor(hex)) return '#081127';
  return contrast(hex, '#081127') >= contrast(hex, '#ffffff') ? '#081127' : '#ffffff';
}

/** A site's font-family, mapped to the nearest font Pactlab carries (app and PDFs). */
export function nearestBrandFont(family: string | null | undefined): BrandFont {
  // The first family is the site's choice; the rest are fallbacks.
  const first = ((family ?? '').split(',')[0] ?? '').replace(/["']/g, '').trim().toLowerCase();
  if (/inter|helvetica|arial|roboto|sf pro|system-ui|segoe|open sans|lato|source sans|ibm plex sans/.test(first)) return 'INTER';
  if (/(^|[^-])serif|georgia|times|garamond|merriweather|playfair|lora/.test(first) && !/sans/.test(first)) return 'SOURCE_SERIF';
  return 'MANROPE';
}
