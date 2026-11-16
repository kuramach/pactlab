// Shared by the server page and the client library (a 'use client' module's functions can't be called on the server).

/**
 * The documents URL with some parameters changed (undefined removes one). Search, type and order run
 * in the database (T-126); changing one starts the library again at its first page.
 */
export function libraryHref(params: Readonly<Record<string, string>>, overrides: Record<string, string | undefined>): string {
  const query = new URLSearchParams(params);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) query.delete(key);
    else query.set(key, value);
  }
  if (['q', 'kind', 'sort', 'dir'].some((key) => key in overrides)) {
    query.delete('docs.cursor');
    query.delete('docs.trail');
  }
  return query.toString();
}
