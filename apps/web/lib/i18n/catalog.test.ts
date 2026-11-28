import { CatalogError, localize, placeholders, stringPaths, type Localized } from '@pactlab/ui';
import { describe, expect, it } from 'vitest';
import { en, type Messages } from '../../messages/en';
import { APP_LOCALES, EN, i18nFor, OFFERED_LOCALES, resolveLocale, TRANSLATIONS } from './index';

const at = (value: unknown, path: string): unknown =>
  path
    .replace(/^\$\.?/, '')
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], value);

describe('the app catalogs (T-172)', () => {
  it('has a complete catalog for every language, with the same placeholders (T-173)', () => {
    // Every language the app knows, offered or not: a catalog behind the pilot flag must still be whole, so enabling it is a config flip.
    for (const locale of APP_LOCALES) {
      if (locale === 'en') continue;
      const overlay = TRANSLATIONS[locale];
      expect(overlay, `${locale} has no catalog`).toBeDefined();
      expect(() => localize(en, overlay as Localized<Messages>, locale)).not.toThrow();
      for (const path of stringPaths(en)) {
        const source = at(en, path) as string;
        const translated = at(overlay, path) as string;
        expect(placeholders(translated), `${locale} ${path}`).toEqual(placeholders(source));
      }
    }
  });

  it('offers a language only when it has a catalog', () => {
    for (const locale of OFFERED_LOCALES) if (locale !== 'en') expect(TRANSLATIONS[locale], `${locale} is offered without a catalog`).toBeDefined();
  });

  it('keeps ICU-style tokens other than {name} out of every catalog', () => {
    for (const locale of ['de', 'fr', 'ja'] as const) {
      for (const path of stringPaths(TRANSLATIONS[locale])) {
        const text = at(TRANSLATIONS[locale], path) as string;
        expect(text, `${locale} ${path}`).not.toMatch(/\{[^}\w][^}]*\}|\{\w+,/);
      }
    }
  });

  it('refuses a translation with a missing or empty string, or a key the source does not have', () => {
    const source = { a: 'One', b: { c: 'Two' } };
    expect(() => localize(source, { a: 'Eins', b: { c: '' } })).toThrow(CatalogError);
    expect(() => localize(source, { a: 'Eins' } as unknown as Localized<typeof source>)).toThrow(CatalogError);
    expect(() => localize(source, { a: 'Eins', b: { c: 'Zwei' }, d: 'x' } as Localized<typeof source>)).toThrow(CatalogError);
    // @ts-expect-error A renamed or missing key fails typecheck: `b` is required.
    const typed: Localized<typeof source> = { a: 'Eins' };
    expect(typed).toBeDefined();
  });

  it('resolves the user over the organization over English, and never a language that is not offered', () => {
    expect(resolveLocale({ user: 'de', organization: 'en' })).toBe('de');
    expect(resolveLocale({ user: undefined, organization: 'de' })).toBe('de');
    expect(resolveLocale({ user: 'xx', organization: undefined })).toBe('en');
    expect(resolveLocale({ user: 'ja', organization: 'de' })).toBe(OFFERED_LOCALES.includes('ja') ? 'ja' : 'de');
    expect(resolveLocale({})).toBe('en');
  });

  it('formats in the reader’s locale while money keeps the pact’s currency', () => {
    const de = i18nFor('de');
    expect(de.money({ amount: '150000000', currency: 'JPY' })).toBe('150.000.000 JPY');
    expect(de.money({ amount: '1234.50', currency: 'EUR' })).toBe('1.234,50 EUR');
    expect(EN.money({ amount: '150000000', currency: 'JPY' })).toBe('JPY 150,000,000');
    expect(de.number(12345)).toBe('12.345');
    expect(de.date('2026-11-27T10:00:00Z')).toBe('27.11.2026');
    expect(EN.date('2026-11-27T10:00:00Z')).toBe('27 Nov 2026');
  });

  it('chooses plural forms by the language’s rules', () => {
    const de = i18nFor('de');
    expect(de.plural(1, de.m.home.pipeline.drafts)).toBe('1 KI-Entwurf wartet auf eine Person');
    expect(de.plural(1200, de.m.home.pipeline.drafts)).toBe('1.200 KI-Entwürfe warten auf eine Person');
    expect(EN.plural(1, EN.m.home.pipeline.documents)).toBe('1 document; AI extraction starts on upload');
    expect(EN.plural(0, EN.m.home.pipeline.documents)).toBe('0 documents; AI extraction starts on upload');
  });

  it('keeps names as German writes them and lower-cases them in English running text', () => {
    expect(EN.inText('Fintech')).toBe('fintech');
    expect(i18nFor('de').inText('Gesundheitswesen')).toBe('Gesundheitswesen');
  });
});
