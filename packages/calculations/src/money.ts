import Decimal from 'decimal.js';

/**
 * Decimal money. Amounts are never JavaScript numbers: inputs are decimal
 * strings, arithmetic uses decimal.js, and output is a fixed-scale string.
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

/** Minor-unit scale per ISO 4217 currency; default is 2. */
const CURRENCY_SCALE: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  BHD: 3,
  KWD: 3,
  JOD: 3,
};

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function currencyScale(currency: string): number {
  return CURRENCY_SCALE[currency] ?? 2;
}

function toDecimal(value: string): Decimal {
  if (typeof value !== 'string' || !DECIMAL_STRING.test(value)) {
    throw new MoneyError('Amounts must be decimal strings, never floating-point numbers');
  }
  return new D(value);
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    readonly currency: string,
  ) {}

  static of(amount: string, currency: string): Money {
    if (!CURRENCY_CODE.test(currency)) {
      throw new MoneyError(`Invalid currency code`);
    }
    return new Money(toDecimal(amount), currency);
  }

  static zero(currency: string): Money {
    return Money.of('0', currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  /** Multiply by a decimal-string factor (e.g. an ARR multiple or a percentage). */
  multiply(factor: string): Money {
    return new Money(this.value.times(toDecimal(factor)), this.currency);
  }

  /**
   * Split into parts proportional to integer-or-decimal string ratios without
   * losing or creating a single minor unit. Remainders go to the earliest parts.
   */
  allocate(ratios: readonly string[]): Money[] {
    if (ratios.length === 0) throw new MoneyError('At least one ratio is required');
    const weights = ratios.map(toDecimal);
    if (weights.some((weight) => weight.isNegative())) throw new MoneyError('Ratios must be non-negative');
    const total = weights.reduce((sum, weight) => sum.plus(weight), new D(0));
    if (total.isZero()) throw new MoneyError('Ratios must not sum to zero');

    const scale = currencyScale(this.currency);
    const unit = new D(1).dividedBy(new D(10).pow(scale));
    const amount = this.value.toDecimalPlaces(scale, Decimal.ROUND_HALF_EVEN);
    const parts = weights.map((weight) =>
      amount.times(weight).dividedBy(total).toDecimalPlaces(scale, Decimal.ROUND_DOWN),
    );
    let remainder = amount.minus(parts.reduce((sum, part) => sum.plus(part), new D(0)));
    const step = remainder.isNegative() ? unit.negated() : unit;
    for (let index = 0; !remainder.isZero(); index = (index + 1) % parts.length) {
      parts[index] = (parts[index] as Decimal).plus(step);
      remainder = remainder.minus(step);
    }
    return parts.map((part) => new Money(part, this.currency));
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    return this.value.comparedTo(other.value) as -1 | 0 | 1;
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  /** Rounded to the currency's minor-unit scale (banker's rounding). */
  toFixed(): string {
    return this.value.toFixed(currencyScale(this.currency), Decimal.ROUND_HALF_EVEN);
  }

  /** Full-precision decimal string for storage in `numeric` columns. */
  toDecimalString(): string {
    return this.value.toFixed();
  }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.toFixed(), currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new MoneyError('Currency mismatch; convert explicitly with a recorded FX rate');
    }
  }
}
