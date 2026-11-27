/**
 * Translations are overlays on the English source (ADR 0057): the same
 * shape with only the words. Slugs, icons, links, images and enum values
 * are structural and always come from the English source, so a translation
 * can never point somewhere else or drop a page.
 */
export const STRUCTURAL_KEYS = ['slug', 'id', 'icon', 'href', 'image', 'gif', 'poster', 'photo', 'linkedin', 'status', 'order', 'pack', 'group', 'step', 'severity', 'initials', 'url', 'number', 'kind'] as const;
type Structural = (typeof STRUCTURAL_KEYS)[number];
const STRUCTURAL: ReadonlySet<string> = new Set(STRUCTURAL_KEYS);

/** The translatable part of a value: every string, at the same place in the same shape. */
export type Localized<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Localized<U>[]
    : T extends object
      ? { readonly [K in keyof T as K extends Structural ? never : T[K] extends string | object | undefined ? K : never]: Localized<T[K]> }
      : never;

/** A translation that does not fit its source. The build fails on it: no page ever falls back to English silently. */
export class CatalogError extends Error {}

/** The English source with every word replaced by the translation's. */
export function localize<T>(source: T, overlay: Localized<T>, path = '$'): T {
  if (typeof source === 'string') {
    if (typeof overlay !== 'string' || overlay.trim() === '') throw new CatalogError(`Missing translation at ${path}`);
    return overlay as T;
  }
  if (Array.isArray(source)) {
    const items = overlay as unknown as readonly unknown[];
    if (!Array.isArray(items) || items.length !== source.length) {
      throw new CatalogError(`Expected ${source.length} entries at ${path}, found ${Array.isArray(items) ? items.length : 'none'}`);
    }
    return source.map((entry: unknown, index) => localize(entry, items[index] as Localized<unknown>, `${path}[${index}]`)) as T;
  }
  if (source && typeof source === 'object') {
    const translated = (overlay ?? {}) as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      result[key] = STRUCTURAL.has(key) || !translatable(value) ? value : localize(value, translated[key] as Localized<unknown>, `${path}.${key}`);
    }
    for (const key of Object.keys(translated)) if (!(key in result) || STRUCTURAL.has(key)) throw new CatalogError(`Unexpected key at ${path}.${key}`);
    return result as T;
  }
  return source;
}

const translatable = (value: unknown): boolean =>
  typeof value === 'string' || (Array.isArray(value) ? value.some(translatable) : value !== null && typeof value === 'object' && Object.entries(value).some(([key, entry]) => !STRUCTURAL.has(key) && translatable(entry)));

/** Every translatable string's path, for the completeness test. */
export function stringPaths(value: unknown, path = '$'): string[] {
  if (typeof value === 'string') return [path];
  if (Array.isArray(value)) return value.flatMap((entry, index) => stringPaths(entry, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => (STRUCTURAL.has(key) ? [] : stringPaths(entry, `${path}.${key}`)));
  }
  return [];
}

/** `{name}` placeholders; `{name|lower}` lower-cases the value (English running text only). */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)(\|lower)?\}/g, (match, key: string, lower?: string) => {
    const value = values[key];
    if (value === undefined) throw new CatalogError(`No value for ${match} in "${template}"`);
    return lower ? String(value).toLowerCase() : String(value);
  });
}
