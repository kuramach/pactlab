/**
 * Exact decimal arithmetic for pricing (rule 3: never a float for money). Values are scaled integers
 * at six decimals; division rounds half to even, as storage and the formatter do (ADR 0056).
 */
export const SCALE = 6;
export const FACTOR = 10n ** BigInt(SCALE);

const DECIMAL = /^-?\d{1,15}(\.\d{1,6})?$/;

/** "27500", "0.05", "1.5" → scaled integer; null when it is not a plain decimal. */
export function toScaled(raw: string): bigint | null {
  const text = raw.trim();
  if (!DECIMAL.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const value = BigInt(whole) * FACTOR + BigInt(fraction.padEnd(SCALE, '0'));
  return negative ? -value : value;
}

/** A scaled integer back to a decimal string with exactly `decimals` places (0 to 6). */
export function fromScaled(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / FACTOR;
  const fraction = (absolute % FACTOR).toString().padStart(SCALE, '0').slice(0, decimals);
  return `${negative ? '-' : ''}${whole}${decimals > 0 ? `.${fraction}` : ''}`;
}

/** n ÷ d for n ≥ 0, d > 0, rounded half to even. */
export function divideHalfEven(n: bigint, d: bigint): bigint {
  const quotient = n / d;
  const twice = (n % d) * 2n;
  if (twice > d || (twice === d && quotient % 2n === 1n)) return quotient + 1n;
  return quotient;
}

/** `product` is a scaled value multiplied by `divisor × FACTOR`; rounded to a whole number of `unit`s (scaled), returned scaled. */
export function roundToUnit(product: bigint, divisor: bigint, unit: bigint): bigint {
  return divideHalfEven(product, divisor * unit * FACTOR) * unit;
}
