/**
 * The app's languages and how a reader's is chosen (T-172, ADR 0064). The same launch set as the site (T-171):
 * English (the source), German, French and Japanese. Plain data and pure functions, so the server, settings and
 * tests read one definition.
 */
export const APP_LOCALES = ['en', 'de', 'fr', 'ja'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export type TranslatedAppLocale = Exclude<AppLocale, 'en'>;

export const isAppLocale = (value: unknown): value is AppLocale => typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value);

/** Each language named in itself, for the language setting. */
export const APP_LOCALE_NAMES: Readonly<Record<AppLocale, string>> = { en: 'English', de: 'Deutsch', fr: 'Français', ja: '日本語' };

/**
 * The locale numbers and dates are formatted in. English is `null`: the shared formatter then keeps its own
 * defaults (en-US, and en-IN for rupee amounts), so English screens read exactly as before.
 */
export const FORMAT_LOCALE: Readonly<Record<AppLocale, string | null>> = { en: null, de: 'de-DE', fr: 'fr-FR', ja: 'ja-JP' };

/**
 * Whether a name is lower-cased inside running text ("Run fintech checks"). German capitalizes nouns, so it keeps
 * the name as written. A property of the language, not of any one message.
 */
export const LOWER_NAMES_IN_TEXT: Readonly<Record<AppLocale, boolean>> = { en: true, de: false, fr: true, ja: false };

/** The BCP 47 tag for `<html lang>` and plural rules. */
export const HTML_LANG: Readonly<Record<AppLocale, string>> = { en: 'en', de: 'de', fr: 'fr', ja: 'ja' };

/**
 * Which languages a person can choose. A language is offered only once its catalog covers every string the app
 * has moved into the catalog (the completeness test checks it). German covers the pilot surface (the pact home and
 * findings); French and Japanese arrive with T-173.
 */
export const OFFERED_LOCALES: readonly AppLocale[] = ['en', 'de'];
export const isOfferedLocale = (value: unknown): value is AppLocale => isAppLocale(value) && OFFERED_LOCALES.includes(value);

/** The reader's choice on this device; set only from Settings → Language. */
export const APP_LOCALE_COOKIE = 'pactlab_locale';
export const APP_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_APP_LOCALE: AppLocale = 'en';

/**
 * User over organization over default. A choice that is not offered (a language not yet translated, or a value
 * someone typed into a cookie) is skipped, never shown half-translated.
 */
export function resolveLocale(choices: { readonly user?: unknown; readonly organization?: unknown }): AppLocale {
  if (isOfferedLocale(choices.user)) return choices.user;
  if (isOfferedLocale(choices.organization)) return choices.organization;
  return DEFAULT_APP_LOCALE;
}
