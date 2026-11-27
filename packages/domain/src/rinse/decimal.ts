/**
 * Exact decimal arithmetic for the rinse audit (rule 3: never a float for money). Amounts are read as
 * scaled integers at a common scale, so "1,234.50" and "1234.5" compare equal and a column foots exactly.
 */
const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);

/** "1,234.50", "(1,234.50)", "-1234.5", "USD 1,234" → scaled integer; null when it is not a number. */
export function parseAmount(raw: string): bigint | null {
  let text = raw.trim().replace(/^[A-Z]{3}\s+/, '').replace(/\s+[A-Z]{3}$/, '').replace(/[$£€¥₹]/g, '').trim();
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1).trim();
  }
  if (!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(text)) return null;
  const [whole = '0', fraction = ''] = text.replace(/,/g, '').split('.');
  if (fraction.length > SCALE) return null;
  const value = BigInt(whole) * FACTOR + BigInt(fraction.padEnd(SCALE, '0') || '0');
  return negative ? -value : value;
}

/** A scaled integer back to a plain decimal string, trailing zeros dropped ("1234.5"). */
export function formatScaled(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / FACTOR;
  const fraction = (absolute % FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Normalise a decimal string ("1,234.50" → "1234.5"); the original text when it is not a number. */
export function normalizeAmount(raw: string): string {
  const value = parseAmount(raw);
  return value === null ? raw.trim() : formatScaled(value);
}
