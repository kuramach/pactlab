import { isHexColor, nearestBrandFont, type BrandFont } from '@pactlab/domain';
import { SafeFetchError, type WebFetcher } from '../common/safe-fetch';
import { pngPaletteColor, sniffLogo, type LogoType } from './image';

/** What the website suggests (T-123): a draft an admin reviews, never applied on its own. */
export interface BrandDraft {
  readonly websiteUrl: string;
  readonly logo: { readonly bytes: Buffer; readonly type: LogoType; readonly width: number | null; readonly height: number | null; readonly from: string } | null;
  readonly accentColor: string | null;
  readonly primaryColor: string | null;
  readonly font: BrandFont;
  readonly fontFamily: string | null;
  /** What was found and what was not, for the admin. */
  readonly notes: readonly string[];
}

const HTML_MAX = 1024 * 1024;
const CSS_MAX = 512 * 1024;
export const LOGO_MAX = 512 * 1024;

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(2).find((value) => value !== undefined) ?? null;
const tags = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];
const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");

function normalizeColor(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(trimmed);
  const hex = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : trimmed;
  if (!isHexColor(hex)) return null;
  // Near-white, near-black and greys are not a brand accent.
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min < 24 ? null : hex;
}

/** Logo candidates, best first: schema.org, a large icon, the Open Graph image, a header logo. */
function logoCandidates(html: string, base: URL): { url: URL; from: string }[] {
  const found: { url: string; from: string }[] = [];
  for (const block of html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? []) {
    const logo = /"logo"\s*:\s*(?:"([^"]+)"|\{[^}]*"url"\s*:\s*"([^"]+)")/.exec(block);
    const value = logo?.[1] ?? logo?.[2];
    if (value) found.push({ url: value, from: 'the site’s organization data (schema.org)' });
  }
  for (const tag of tags(html, 'link')) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    const href = attr(tag, 'href');
    if (!href) continue;
    if (rel.includes('apple-touch-icon')) found.push({ url: href, from: 'the site’s app icon' });
    else if (rel.includes('icon') && Number(/(\d+)x\d+/.exec(attr(tag, 'sizes') ?? '')?.[1] ?? 0) >= 128) found.push({ url: href, from: 'the site’s large icon' });
  }
  for (const tag of tags(html, 'meta')) {
    if ((attr(tag, 'property') ?? '').toLowerCase() === 'og:image' && attr(tag, 'content')) found.push({ url: attr(tag, 'content') as string, from: 'the site’s sharing image' });
  }
  const header = /<header\b[\s\S]*?<\/header>/i.exec(html)?.[0] ?? '';
  for (const tag of tags(header, 'img')) {
    const src = attr(tag, 'src');
    if (src && /logo/i.test(`${src} ${attr(tag, 'alt') ?? ''} ${attr(tag, 'class') ?? ''}`)) found.push({ url: src, from: 'the logo in the site’s header' });
  }
  return found.flatMap((candidate) => {
    try {
      return [{ url: new URL(decode(candidate.url), base), from: candidate.from }];
    } catch {
      return [];
    }
  });
}

function cssColor(css: string): string | null {
  const variable = /--(?:color-)?(?:primary|brand|accent)[a-z0-9-]*\s*:\s*(#[0-9a-f]{3,6})\b/i.exec(css)?.[1];
  return normalizeColor(variable ?? null);
}

/**
 * Draft a brand kit from a company's public website. Best-effort: anything missing is a note,
 * and nothing is applied until an admin reviews it. Every request goes through the SSRF-safe fetcher.
 */
export async function extractBrand(fetcher: WebFetcher, websiteUrl: string): Promise<BrandDraft> {
  const notes: string[] = [];
  let page;
  try {
    page = await fetcher.get(new URL(websiteUrl), { maxBytes: HTML_MAX, accept: 'text/html' });
  } catch (error) {
    const reason = error instanceof SafeFetchError ? error.reason : 'FAILED';
    return { websiteUrl, logo: null, accentColor: null, primaryColor: null, font: 'MANROPE', fontFamily: null, notes: [`The website could not be read (${reason.toLowerCase().replaceAll('_', ' ')}). Upload a logo and pick colors instead.`] };
  }
  if (page.status !== 200 || !/html/i.test(page.contentType)) {
    return { websiteUrl, logo: null, accentColor: null, primaryColor: null, font: 'MANROPE', fontFamily: null, notes: [`The website answered ${page.status} without a web page. Upload a logo and pick colors instead.`] };
  }
  const html = page.body.toString('utf8');

  // The logo: the first candidate that is really a PNG, JPEG or SVG within the size cap.
  let logo: BrandDraft['logo'] = null;
  for (const candidate of logoCandidates(html, page.url).slice(0, 6)) {
    try {
      const response = await fetcher.get(candidate.url, { maxBytes: LOGO_MAX, accept: 'image/png,image/jpeg,image/svg+xml' });
      const sniffed = response.status === 200 ? sniffLogo(response.body) : null;
      if (sniffed) {
        logo = { bytes: response.body, ...sniffed, from: candidate.from };
        break;
      }
    } catch {
      // Try the next candidate.
    }
  }
  notes.push(logo ? `Logo taken from ${logo.from}.` : 'No usable logo found (PNG, JPEG or SVG under 512 KB). Upload one.');

  // Colors: the declared theme color, else a brand-named CSS variable, else the logo's palette.
  let accent = normalizeColor(tags(html, 'meta').find((tag) => (attr(tag, 'name') ?? '').toLowerCase() === 'theme-color')?.match(/content\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? null);
  let css = (html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) ?? []).join('\n');
  const stylesheet = tags(html, 'link').find((tag) => (attr(tag, 'rel') ?? '').toLowerCase().includes('stylesheet') && attr(tag, 'href'));
  if (stylesheet) {
    try {
      const response = await fetcher.get(new URL(decode(attr(stylesheet, 'href') as string), page.url), { maxBytes: CSS_MAX, accept: 'text/css' });
      if (response.status === 200) css += `\n${response.body.toString('utf8')}`;
    } catch {
      // The page's own styles are enough to go on.
    }
  }
  accent ??= cssColor(css);
  if (!accent && logo?.type === 'image/png') accent = normalizeColor(pngPaletteColor(logo.bytes));
  notes.push(accent ? `Accent color ${accent} found.` : 'No brand color found. Pick one.');

  const family = /font-family\s*:\s*([^;}]+)/i.exec(css)?.[1]?.trim() ?? null;
  const font = nearestBrandFont(family);
  notes.push(family ? `The site uses ${family.split(',')[0]?.replace(/["']/g, '').trim()}; the nearest Pactlab font is used.` : 'No font found; Manrope is used.');

  return { websiteUrl, logo, accentColor: accent, primaryColor: null, font, fontFamily: family, notes };
}
