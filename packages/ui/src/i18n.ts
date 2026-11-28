/**
 * Message catalogs (T-172, ADR 0064): the same conventions as the site (T-171, ADR 0057). English is the source;
 * a translation is an overlay of the same shape with only the words, checked by the compiler (`Localized<T>`) and,
 * when built, by `localize`, which throws on any missing or empty string, so no screen ever falls back to English
 * key by key. Placeholders are `{name}`; plurals are a forms object chosen by `Intl.PluralRules`.
 */

/** The translatable shape of a source catalog: every string, at the same place. */
export type Localized<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Localized<U>[]
    : T extends object
      ? { readonly [K in keyof T]: Localized<T[K]> }
      : never;

/** A translation that does not fit its source. Raised at build or first use; never swallowed. */
export class CatalogError extends Error {}

/** The English source with every word replaced by the translation's. */
export function localize<T>(source: T, overlay: Localized<T>, path = '$'): T {
  if (typeof source === 'string') {
    if (typeof overlay !== 'string' || overlay.trim() === '') throw new CatalogError(`Missing translation at ${path}`);
    return overlay as T;
  }
  if (Array.isArray(source)) {
    const items = overlay as unknown as readonly unknown[];
    if (!Array.isArray(items) || items.length !== source.length) throw new CatalogError(`Expected ${source.length} entries at ${path}`);
    return source.map((entry: unknown, index) => localize(entry, items[index] as Localized<unknown>, `${path}[${index}]`)) as T;
  }
  if (source && typeof source === 'object') {
    const translated = (overlay ?? {}) as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) result[key] = localize(value, translated[key] as Localized<unknown>, `${path}.${key}`);
    for (const key of Object.keys(translated)) if (!(key in result)) throw new CatalogError(`Unexpected key at ${path}.${key}`);
    return result as T;
  }
  return source;
}

/** Every string's path, for completeness tests. */
export function stringPaths(value: unknown, path = '$'): string[] {
  if (typeof value === 'string') return [path];
  if (Array.isArray(value)) return value.flatMap((entry, index) => stringPaths(entry, `${path}[${index}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => stringPaths(entry, `${path}.${key}`));
  return [];
}

/** The `{name}` placeholders in a message, for checking that a translation keeps them. */
export function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string).sort();
}

/** `fill('{count} findings', { count: '3' })`. A placeholder with no value is left visible, never dropped. */
export function fill(message: string, values: Readonly<Record<string, string | number>>): string {
  return message.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

/**
 * A message in plural forms. `one` and `other` are always required (English needs both); a language with more
 * forms adds them, and a language with fewer still fills both. `{count}` is the formatted count.
 */
export interface PluralForms {
  readonly zero?: string;
  readonly one: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

const PLURAL_RULES = new Map<string, Intl.PluralRules>();

/** The form for `count` in `locale`, with `{count}` and any other values filled in. */
export function plural(locale: string, count: number, forms: PluralForms, values: Readonly<Record<string, string | number>> = {}, formatted = String(count)): string {
  let rules = PLURAL_RULES.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    PLURAL_RULES.set(locale, rules);
  }
  const form = rules.select(count) as keyof PluralForms;
  return fill(forms[form] ?? forms.other, { count: formatted, ...values });
}
