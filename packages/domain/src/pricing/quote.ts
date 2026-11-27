import { currencyMinorUnits } from '../money/currencies';
import { assertPriceBook, type PriceBook, type PriceBookAllowance } from './book';
import { fromScaled, roundToUnit, toScaled } from './decimal';

/** One band's line of the variable: the slice of enterprise value it priced, and what it added. */
export interface QuoteBandLine {
  from: string;
  upTo: string | null;
  bps: string;
  /** The slice of enterprise value inside this band. */
  slice: string;
  amount: string;
}

/**
 * A pact quote: the fixed and variable lines itemized, so the buyer sees exactly what the size of
 * their deal adds. Every amount is in the book's currency, rounded to its unit; lines foot as shown.
 */
export interface PactQuote {
  currency: string;
  bookVersion: number;
  pilot: boolean;
  /** The enterprise value the variable priced (null for a pilot, which has no variable). */
  enterpriseValue: string | null;
  fixed: string;
  variable: {
    bands: QuoteBandLine[];
    /** The sum of the band lines, before the cap. */
    uncapped: string;
    capped: boolean;
    cap: string;
    amount: string;
  };
  total: string;
  includes: PriceBookAllowance;
}

export class QuoteInputError extends Error {}

/**
 * Prices a pact off one book, deterministically. The variable is computed in the book's own
 * currency on the deal's enterprise value as declared at purchase; a pilot quotes the flat rate at
 * any size. No true-up later: the quote is what is collected (T-177 non-goal).
 */
export function quotePact(book: PriceBook, input: { enterpriseValue: string | null; pilot?: boolean }): PactQuote {
  assertPriceBook(book);
  const unit = toScaled(book.rounding) ?? 1n;
  const decimals = Math.min(currencyMinorUnits(book.currency), 6);
  const show = (value: bigint) => fromScaled(value, decimals);
  const cap = toScaled(book.variableCap) ?? 0n;

  if (input.pilot) {
    return {
      currency: book.currency,
      bookVersion: book.version,
      pilot: true,
      enterpriseValue: null,
      fixed: show(toScaled(book.pilotFlat) ?? 0n),
      variable: { bands: [], uncapped: show(0n), capped: false, cap: show(cap), amount: show(0n) },
      total: show(toScaled(book.pilotFlat) ?? 0n),
      includes: book.baseIncludes,
    };
  }

  const value = input.enterpriseValue === null ? null : toScaled(input.enterpriseValue);
  if (input.enterpriseValue !== null && (value === null || value < 0n)) throw new QuoteInputError('The enterprise value must be a plain non-negative amount.');
  const ev = value ?? 0n;

  const bands: QuoteBandLine[] = [];
  let includes = book.baseIncludes;
  let from = 0n;
  let uncapped = 0n;
  for (const band of book.bands) {
    if (ev <= from) break;
    const upTo = band.upTo === null ? null : (toScaled(band.upTo) ?? 0n);
    const top = upTo === null || ev < upTo ? ev : upTo;
    const slice = top - from;
    // slice × bps ÷ 10,000, each scaled by FACTOR: rounded once per line, so the lines foot.
    const line = roundToUnit(slice * (toScaled(band.bps) ?? 0n), 10_000n, unit);
    bands.push({ from: show(from), upTo: upTo === null ? null : show(upTo), bps: band.bps, slice: show(slice), amount: show(line) });
    uncapped += line;
    includes = band.includes;
    if (upTo === null) break;
    from = upTo;
  }

  const capped = uncapped > cap;
  const variable = capped ? cap : uncapped;
  const fixed = toScaled(book.fixedFee) ?? 0n;
  return {
    currency: book.currency,
    bookVersion: book.version,
    pilot: false,
    enterpriseValue: value === null ? null : show(ev),
    fixed: show(fixed),
    variable: { bands, uncapped: show(uncapped), capped, cap: show(cap), amount: show(variable) },
    total: show(fixed + variable),
    includes,
  };
}
