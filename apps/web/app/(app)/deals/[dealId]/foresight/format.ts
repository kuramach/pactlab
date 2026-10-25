/** "12" (a percent, as typed) → "0.12"; "7.5" → "0.075". Exact decimal-string shifting, never floats. */
export function percentToFraction(input: string): string | null {
  const text = input.trim();
  if (!/^-?\d{1,3}(\.\d{1,4})?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole = '0', decimals = ''] = text.replace('-', '').split('.');
  const digits = `${whole}${decimals}`.padStart(decimals.length + 3, '0');
  const point = digits.length - decimals.length - 2;
  let value = `${digits.slice(0, point)}.${digits.slice(point)}`.replace(/^0+(?=\d)/, '');
  value = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  return negative && value !== '0' ? `-${value}` : value;
}

/** "0.075" → "7.5"; for showing stored fractions as percents. */
export function fractionToPercent(fraction: string): string {
  const negative = fraction.startsWith('-');
  const [whole = '0', decimals = ''] = fraction.replace('-', '').split('.');
  const padded = decimals.padEnd(2, '0');
  const integer = `${whole}${padded.slice(0, 2)}`.replace(/^0+(?=\d)/, '');
  const rest = padded.slice(2).replace(/0+$/, '');
  return `${negative ? '-' : ''}${integer}${rest ? `.${rest}` : ''}`;
}
