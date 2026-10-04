import Decimal from 'decimal.js';
import { Money } from '../money';
import type { MoneyValue } from './types';

/** Same decimal context as Money: 40 significant digits, banker's rounding. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

/** Ratios (retention, shares) are reported to four decimal places. */
export const RATIO_SCALE = 4;

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/** Parse a decimal string; anything else (including numbers and exponents) is null. */
export function parseDecimal(value: string | null | undefined): Decimal | null {
  return typeof value === 'string' && DECIMAL_STRING.test(value) ? new D(value) : null;
}

export function sum(values: Iterable<Decimal>): Decimal {
  let total = new D(0);
  for (const value of values) total = total.plus(value);
  return total;
}

/** Fixed-scale money for output; rounding happens only here. */
export function money(value: Decimal, currency: string): MoneyValue {
  return Money.of(value.toFixed(), currency).toJSON();
}

export function ratio(numerator: Decimal, denominator: Decimal): string | null {
  return denominator.isZero()
    ? null
    : numerator.dividedBy(denominator).toFixed(RATIO_SCALE, Decimal.ROUND_HALF_EVEN);
}
