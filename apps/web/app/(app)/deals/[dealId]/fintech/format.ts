/**
 * A decimal fraction as a percentage with a fixed number of places, rounded half up on the digits
 * (no floating point): `'0.009412'` → `'0.94%'`; null → `'—'`.
 */
export function percentOf(value: string | null | undefined, places: number): string {
  if (value === null || value === undefined) return '—';
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;
  const [, sign = '', whole = '0', fraction = ''] = match;
  // value × 100 with `places` decimals = the digits shifted by 2 + places, then rounded on the next digit.
  const shift = 2 + places;
  const digits = BigInt(`${whole}${fraction.padEnd(shift + 1, '0').slice(0, shift + 1)}`);
  const rounded = (digits + 5n) / 10n;
  const text = rounded.toString().padStart(places + 1, '0');
  const integer = text.slice(0, text.length - places) || '0';
  const decimals = places ? `.${text.slice(text.length - places)}` : '';
  return `${sign && rounded !== 0n ? '−' : ''}${integer}${decimals}%`;
}
