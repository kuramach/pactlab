import { formatAmount, formatDate, formatDateTime, formatMoney, formatMoneyRange, formatNumber, type MoneyFormatOptions, type MoneyLike } from '@pactlab/domain';
import { fill, localize, plural, type Localized, type PluralForms } from '@pactlab/ui';
import { de } from '../../messages/de';
import { fr } from '../../messages/fr';
import { ja } from '../../messages/ja';
import { en, type Messages } from '../../messages/en';
import { FORMAT_LOCALE, HTML_LANG, LOWER_NAMES_IN_TEXT, type AppLocale, type TranslatedAppLocale } from './locales';

export * from './locales';
export type { Messages } from '../../messages/en';

/** Every translation the app has. A locale without one is not offered (`OFFERED_LOCALES`). */
export const TRANSLATIONS: Partial<Readonly<Record<TranslatedAppLocale, Localized<Messages>>>> = { de, fr, ja };

/**
 * A reader's words and formats (T-172). Words come from the catalog; numbers, dates and money go through the one
 * shared formatter (T-170) in the reader's locale. Locale and currency are independent: a German reader of a yen
 * pact sees `150.000.000 JPY`, never euros.
 */
export interface I18n {
  readonly locale: AppLocale;
  readonly lang: string;
  readonly m: Messages;
  readonly fill: (message: string, values: Readonly<Record<string, string | number>>) => string;
  /** The plural form for `count`, with `{count}` formatted for the reader. */
  readonly plural: (count: number, forms: PluralForms, values?: Readonly<Record<string, string | number>>) => string;
  /** A name as it reads inside a sentence (lower-cased in English, kept in German). */
  readonly inText: (name: string) => string;
  readonly number: (value: string | number | bigint) => string;
  readonly money: (value: MoneyLike | null | undefined, options?: MoneyFormatOptions) => string;
  readonly amount: (amount: string, currency: string, options?: MoneyFormatOptions) => string;
  readonly moneyRange: (low: string, high: string, currency: string) => string;
  readonly date: (value: string | Date) => string;
  readonly dateTime: (value: string | Date) => string;
}

const BUILT = new Map<AppLocale, I18n>();

function messagesFor(locale: AppLocale): Messages {
  if (locale === 'en') return en;
  const overlay = TRANSLATIONS[locale];
  // Never offered without a catalog (resolveLocale); reaching here is a bug, not a reason to show English.
  if (!overlay) throw new Error(`No catalog for ${locale}`);
  return localize(en, overlay, locale);
}

/** The reader's i18n for a locale, built once. English keeps the formatter's own defaults, so English screens are unchanged. */
export function i18nFor(locale: AppLocale): I18n {
  let built = BUILT.get(locale);
  if (built) return built;
  const format = FORMAT_LOCALE[locale];
  // English dates keep the day-month-year style the app has always shown.
  const dateLocale = format ?? 'en-GB';
  const withLocale = <T extends object>(options: T | undefined) => (format ? { ...options, locale: format } : (options ?? ({} as T)));
  const number = (value: string | number | bigint) => formatNumber(value, format ? { locale: format } : {});
  built = {
    locale,
    lang: HTML_LANG[locale],
    m: messagesFor(locale),
    fill,
    plural: (count, forms, values = {}) => plural(HTML_LANG[locale], count, forms, values, number(count)),
    inText: (name) => (LOWER_NAMES_IN_TEXT[locale] ? name.toLocaleLowerCase(HTML_LANG[locale]) : name),
    number,
    money: (value, options) => formatMoney(value, withLocale(options)),
    amount: (amount, currency, options) => formatAmount(amount, currency, withLocale(options)),
    moneyRange: (low, high, currency) => {
      const range = formatMoneyRange(low, high, currency, withLocale<MoneyFormatOptions>(undefined));
      // The shared range puts the code on the low end (`USD 1,000 – 3,000`). Where a locale writes the code after the
      // amount (`1.000 USD`), the code moves to the high end: `1.000 – 3.000 USD`.
      const code = ` ${currency.toUpperCase()}`;
      const [first, second] = range.split(' – ');
      return first?.endsWith(code) && second !== undefined ? `${first.slice(0, -code.length)} – ${second}${code}` : range;
    },
    date: (value) => formatDate(value, { locale: dateLocale }),
    dateTime: (value) => formatDateTime(value, { locale: dateLocale }),
  };
  BUILT.set(locale, built);
  return built;
}

/** English, for shared pieces whose callers have not moved to the reader's locale yet. */
export const EN = i18nFor('en');
