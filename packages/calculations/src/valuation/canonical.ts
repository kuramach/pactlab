import { createHash } from 'node:crypto';

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

function canonical(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      // Only safe integers (versions, year counts); fractional values must be decimal strings.
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalJsonError('Only safe integers may be numbers; use decimal strings');
      }
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
    }
    default:
      throw new CanonicalJsonError(`Unsupported value type: ${typeof value}`);
  }
}

/**
 * Canonical JSON: sorted keys, no whitespace, `undefined` members dropped,
 * floating-point numbers rejected. Equal values always give equal bytes.
 */
export function canonicalJson(value: unknown): string {
  return canonical(value);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
