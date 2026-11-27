/**
 * The site's languages (T-171, ADR 0057). English is the source and stays
 * unprefixed (it serves the US, the UK and India); German, French and
 * Japanese live under /de, /fr and /ja. Plain data and pure functions only:
 * the edge function's configuration (`app/locales.json`) is built from this
 * file, so the site and the CloudFront Function cannot disagree.
 */
export const LOCALES = ['en', 'de', 'fr', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];
export type TranslatedLocale = Exclude<Locale, 'en'>;
export const TRANSLATED_LOCALES: readonly TranslatedLocale[] = ['de', 'fr', 'ja'];

export const isLocale = (value: string): value is Locale => (LOCALES as readonly string[]).includes(value);
export const isTranslatedLocale = (value: string): value is TranslatedLocale => (TRANSLATED_LOCALES as readonly string[]).includes(value);

/** Each language named in itself, for the switcher. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { en: 'English', de: 'Deutsch', fr: 'Français', ja: '日本語' };

/** BCP 47 tags for `<html lang>`, hreflang and OpenGraph. */
export const HTML_LANG: Readonly<Record<Locale, string>> = { en: 'en', de: 'de', fr: 'fr', ja: 'ja' };
export const OG_LOCALE: Readonly<Record<Locale, string>> = { en: 'en_US', de: 'de_DE', fr: 'fr_FR', ja: 'ja_JP' };

/**
 * The native-review checklist for each translation (T-171 Build 3). The
 * translations are machine-made; a locale is linked from the switcher,
 * listed in hreflang and the sitemap, indexed and used by country detection
 * only once a native speaker has completed its checklist
 * (docs/runbooks/site-translations.md) and this flag is set in the same PR.
 * Until then its pages exist at their route but are reachable only by URL
 * and carry noindex.
 */
export const NATIVE_REVIEW: Readonly<Record<TranslatedLocale, { readonly complete: boolean }>> = {
  de: { complete: false },
  fr: { complete: false },
  ja: { complete: false },
};

/** An environment's copy of the site (dev, qa, e2e) previews every translation before its review completes. */
export const LOCALE_PREVIEW = process.env['NEXT_PUBLIC_LOCALE_PREVIEW'] === 'true';

/** A locale the site links, indexes and routes visitors to. */
export const isPublishedLocale = (locale: Locale): boolean => locale === 'en' || LOCALE_PREVIEW || NATIVE_REVIEW[locale].complete;
export const PUBLISHED_LOCALES: readonly Locale[] = LOCALES.filter(isPublishedLocale);

/**
 * Country detection (Kumar, 2026-11-26): ISO 3166-1 alpha-2 from the
 * CloudFront-Viewer-Country header. Every other country, the US, the UK and
 * India included, gets English.
 */
export const COUNTRY_LOCALE: Readonly<Record<string, TranslatedLocale>> = { DE: 'de', AT: 'de', CH: 'de', FR: 'fr', BE: 'fr', JP: 'ja' };

/** Set by the switcher only. Once present it always wins over country detection. */
export const LOCALE_COOKIE = 'pactlab_locale';
/** Set at the edge from the viewer's country; read by the pilot request to pre-select the country. */
export const COUNTRY_COOKIE = 'pactlab_country';
/** A year: a manual language choice is remembered. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Pages that exist in every language. Everything else (product modules,
 * pricing, trust, try, pilot, case-study bodies, legal) is English only, and
 * links to it from a translated page go to the English page.
 */
const LOCALIZED = [/^\/$/, /^\/how-it-works$/, /^\/rinse$/, /^\/guides(\/[^/]+)?$/, /^\/faq(\/[^/]+)?$/, /^\/compare\/[^/]+$/, /^\/about(\/(story|vision))?$/, /^\/case-studies$/, /^\/industries(\/[^/]+)?$/];

/** Strip a trailing slash (except the root) so `/faq/` and `/faq` compare equal. */
const normalize = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

export const isLocalizedPath = (path: string): boolean => LOCALIZED.some((pattern) => pattern.test(normalize(path)));

/**
 * The entry and section-root paths country detection may redirect from
 * (T-171 Build 4). Deeper pages are never redirected: someone following a
 * link to a specific page lands on that page.
 */
export const ENTRY_PATHS: readonly string[] = ['/', '/how-it-works', '/guides', '/faq', '/industries', '/about', '/case-studies'];

/** The same page in another language: prefixed for a translation, unchanged for English or an English-only page. */
export function localeHref(locale: Locale, path: string): string {
  if (locale === 'en' || !path.startsWith('/') || !isLocalizedPath(path.split('#')[0] ?? path)) return path;
  return path === '/' ? `/${locale}` : `/${locale}${path}`;
}

/** The locale and unprefixed path of a site path: `/de/faq` → `de`, `/faq`. */
export function splitLocale(path: string): { locale: Locale; path: string } {
  const [, first, ...rest] = path.split('/');
  if (first && isTranslatedLocale(first)) return { locale: first, path: normalize(`/${rest.join('/')}`) };
  return { locale: 'en', path: normalize(path) || '/' };
}

/** What the CloudFront Function needs, published by the build as /locales.json and read by the CDK stack at synth. */
export function edgeLocaleConfig() {
  return {
    cookie: LOCALE_COOKIE,
    countryCookie: COUNTRY_COOKIE,
    /** Every prefix a URL may carry: detection never fires under one, published or not. */
    prefixes: [...TRANSLATED_LOCALES],
    /** Where a visitor may be sent. */
    published: PUBLISHED_LOCALES.filter((locale) => locale !== 'en'),
    countries: COUNTRY_LOCALE,
    entryPaths: ENTRY_PATHS,
  };
}
