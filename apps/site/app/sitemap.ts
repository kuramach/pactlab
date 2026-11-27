import type { MetadataRoute } from 'next';
import { localeHref, PUBLISHED_LOCALES } from '../lib/i18n/locales';
import { SITE_ROUTES, absolute, languageAlternates } from '../lib/seo';

export const dynamic = 'force-static';

/** Every page, and each published translation of it with its hreflang alternates (T-171). */
export default function sitemap(): MetadataRoute.Sitemap {
  return SITE_ROUTES.flatMap((path) => {
    const languages = languageAlternates(path);
    const locales = languages ? PUBLISHED_LOCALES : (['en'] as const);
    return locales.map((locale) => ({
      url: absolute(localeHref(locale, path)),
      changeFrequency: 'monthly' as const,
      priority: path === '/' ? 1 : 0.7,
      ...(languages ? { alternates: { languages } } : {}),
    }));
  });
}
