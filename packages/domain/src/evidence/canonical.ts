type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace. Two
 * records with the same content always produce the same string (and hash).
 */
export function canonicalJson(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as Json)}`).join(',')}}`;
}
