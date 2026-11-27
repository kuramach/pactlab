import { describe, expect, it } from 'vitest';
import { BANNED_WORDS } from '../content';
import { CATALOGS, site } from './catalog';
import { SOURCE_CATALOG } from './source';
import { isLocalizedPath, localeHref, NATIVE_REVIEW, PUBLISHED_LOCALES, splitLocale, TRANSLATED_LOCALES, edgeLocaleConfig } from './locales';
import { CatalogError, fill, localize, stringPaths, STRUCTURAL_KEYS } from './localize';

const PARTS = ['ui', 'content', 'industries', 'stories', 'faqs', 'guides', 'comparisons', 'cases'] as const;

/** Every translatable string in a value, by path (structural keys such as slugs and links skipped). */
function strings(value: unknown, path = '$', out = new Map<string, string>()): Map<string, string> {
  if (typeof value === 'string') out.set(path, value);
  else if (Array.isArray(value)) value.forEach((entry, index) => strings(entry, `${path}[${index}]`, out));
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) if (!(STRUCTURAL_KEYS as readonly string[]).includes(key)) strings(entry, `${path}.${key}`, out);
  }
  return out;
}

describe('catalog completeness (T-171)', () => {
  for (const locale of TRANSLATED_LOCALES) {
    describe(locale, () => {
      for (const part of PARTS) {
        it(`${part}: every English string has a translation, and nothing else`, () => {
          const source = SOURCE_CATALOG[part];
          const overlay = CATALOGS[locale][part];
          // Exactly the source's translatable paths: none missing, none extra.
          expect(stringPaths(overlay).sort()).toEqual(stringPaths(source).sort());
          // And the overlay fits (throws on an empty string or a length mismatch).
          expect(() => localize(source as never, overlay as never)).not.toThrow();
        });
      }

      it('translates the copy rather than shipping English under a foreign prefix', () => {
        const english = new Map(PARTS.flatMap((part) => [...strings(SOURCE_CATALOG[part], part)]));
        const translated = new Map(PARTS.flatMap((part) => [...strings(CATALOGS[locale][part], part)]));
        // Short strings may legitimately match (brand and product names, acronyms such as ARPU); sentences may not.
        const untranslated = [...translated].filter(([path, text]) => text.length > 40 && text === english.get(path)).map(([path]) => path);
        expect(untranslated).toEqual([]);
      });

      it('uses only the placeholders the English interface words provide', () => {
        // A translation may drop a placeholder its grammar does not need (German says "Branchenbegriff", not "In {name}"); it may never invent one.
        const english = strings(SOURCE_CATALOG.ui);
        for (const [path, text] of strings(CATALOGS[locale].ui)) {
          const names = (value: string) => [...value.matchAll(/\{(\w+)(?:\|lower)?\}/g)].map((match) => match[1]);
          for (const name of names(text)) expect(names(english.get(path) ?? ''), `${locale} ${path}`).toContain(name);
        }
        // Counts and positions always appear.
        for (const path of ['$.home.allPacts', '$.carousel.position', '$.cases.case']) {
          expect(strings(CATALOGS[locale].ui).get(path), path).toMatch(/\{count\}|\{position\}|\{number\}/);
        }
      });

      it('keeps the voice rules: no banned words, no claims the product cannot back', () => {
        const copy = JSON.stringify(CATALOGS[locale]).toLowerCase();
        for (const word of BANNED_WORDS) expect(copy).not.toContain(word);
        for (const claim of ['trusted by', 'our customers', 'soc 2', 'iso 27001']) expect(copy).not.toContain(claim);
      });

      it('builds the whole site in the language with the same pages and links as English', () => {
        const english = site('en');
        const translated = site(locale);
        expect(translated.industries.map((industry) => industry.slug)).toEqual(english.industries.map((industry) => industry.slug));
        expect(translated.faqs.map((page) => [page.slug, page.related.map((link) => link.href)])).toEqual(english.faqs.map((page) => [page.slug, page.related.map((link) => link.href)]));
        expect(translated.guides.map((guide) => guide.slug)).toEqual(english.guides.map((guide) => guide.slug));
        expect(translated.content.carousel.map((slide) => slide.link.href)).toEqual(english.content.carousel.map((slide) => slide.link.href));
        expect(Object.keys(translated.stories).sort()).toEqual(Object.keys(english.stories).sort());
      });
    });
  }

  it('fails the build on a missing or empty translation instead of falling back to English', () => {
    expect(() => localize({ title: 'Hello', items: ['a', 'b'] }, { title: 'Hallo', items: ['a'] })).toThrow(CatalogError);
    expect(() => localize({ title: 'Hello' }, { title: ' ' })).toThrow(CatalogError);
    expect(() => localize({ title: 'Hello' }, {} as never)).toThrow(CatalogError);
    expect(() => localize({ slug: 'x', title: 'Hello' }, { title: 'Hallo', extra: 'y' } as never)).toThrow(CatalogError);
    expect(localize({ slug: 'x', icon: 'Tag', title: 'Hello' }, { title: 'Hallo' })).toEqual({ slug: 'x', icon: 'Tag', title: 'Hallo' });
  });

  it('fills placeholders and refuses a missing value', () => {
    expect(fill('All {section|lower} →', { section: 'Industries' })).toBe('All industries →');
    expect(fill('Fall {number} · {outcome}', { number: 1, outcome: 'Gestoppt' })).toBe('Fall 1 · Gestoppt');
    expect(() => fill('{name}', {})).toThrow(CatalogError);
  });
});

describe('locale routing (T-171)', () => {
  it('prefixes translated pages only, and leaves English-only pages in English', () => {
    expect(localeHref('de', '/')).toBe('/de');
    expect(localeHref('fr', '/industries/fintech')).toBe('/fr/industries/fintech');
    expect(localeHref('ja', '/faq/acquirers')).toBe('/ja/faq/acquirers');
    expect(localeHref('de', '/pricing')).toBe('/pricing');
    expect(localeHref('de', '/product/revenue')).toBe('/product/revenue');
    expect(localeHref('de', '/case-studies/kroger-albertsons')).toBe('/case-studies/kroger-albertsons');
    expect(localeHref('en', '/faq')).toBe('/faq');
    expect(localeHref('de', 'https://example.test/')).toBe('https://example.test/');
    expect(isLocalizedPath('/about/vision/')).toBe(true);
    expect(splitLocale('/ja/faq/')).toEqual({ locale: 'ja', path: '/faq' });
    expect(splitLocale('/de')).toEqual({ locale: 'de', path: '/' });
    expect(splitLocale('/faq/')).toEqual({ locale: 'en', path: '/faq' });
  });

  it('links, indexes and geo-routes a translation only once its native review is complete', () => {
    for (const locale of TRANSLATED_LOCALES) expect(PUBLISHED_LOCALES.includes(locale)).toBe(NATIVE_REVIEW[locale].complete || process.env['NEXT_PUBLIC_LOCALE_PREVIEW'] === 'true');
    expect(edgeLocaleConfig().published).toEqual(PUBLISHED_LOCALES.filter((locale) => locale !== 'en'));
    expect(edgeLocaleConfig().prefixes).toEqual(['de', 'fr', 'ja']);
    expect(edgeLocaleConfig().countries).toEqual({ DE: 'de', AT: 'de', CH: 'de', FR: 'fr', BE: 'fr', JP: 'ja' });
    for (const path of edgeLocaleConfig().entryPaths) expect(isLocalizedPath(path), path).toBe(true);
  });
});
