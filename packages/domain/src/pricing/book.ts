import { currencyMinorUnits, isCurrencyCode } from '../money/currencies';
import { FACTOR, fromScaled, roundToUnit, toScaled } from './decimal';

/**
 * The per-deal price book (T-177, ADR 0025 addendum): a fixed fee per pact plus a small variable on the
 * deal's enterprise value, on a declining scale of basis-point bands, with a cap. One book per market
 * currency, versioned; a quote binds to the version live when it is made. These are data, never code:
 * the numbers Kumar tunes live in the stored book, and this module only checks and applies them.
 */

/** What the pact includes at a price: the scale the variable pays for, shown at checkout. */
export interface PriceBookAllowance {
  /** Documents included in the pact. */
  documents: number;
  /** AI spend included, in the book's currency (decimal string). */
  aiBudget: string;
}

/** One band of the variable: basis points on the slice of enterprise value up to `upTo`. */
export interface PriceBand {
  /** The band's upper bound of enterprise value, in the book's currency; null for the last band. */
  upTo: string | null;
  /** Basis points (1 bp = 0.01%) on the slice of enterprise value inside this band. */
  bps: string;
  /** What a deal whose value tops out in this band includes. */
  includes: PriceBookAllowance;
}

export interface PriceBook {
  /** ISO 4217: the market this book prices, and the currency of every amount in it. */
  currency: string;
  /** Versions count up per currency; each book's history is its own. */
  version: number;
  /** When this version starts pricing new quotes (ISO 8601). */
  effectiveFrom: string;
  /** The fixed fee per pact. */
  fixedFee: string;
  /** What the fixed fee alone includes (a pilot, and a deal of no stated value). */
  baseIncludes: PriceBookAllowance;
  /** Ascending bands; only the last is open-ended. */
  bands: PriceBand[];
  /** The most the variable can add to one deal. */
  variableCap: string;
  /** The pilot's flat price, with no variable. */
  pilotFlat: string;
  /** The unit every amount is rounded to: "0.01" for cents, "1" for whole yen or round rupees. */
  rounding: string;
}

/** A band's basis points must sit in 0–100 (0% to 1% of the slice): a guard against a stray zero. */
export const MAX_BAND_BPS = '100';

export interface PriceBookProblem {
  path: string;
  message: string;
}

function amount(problems: PriceBookProblem[], path: string, raw: string, unit: bigint | null, options: { positive?: boolean } = {}): bigint | null {
  const value = toScaled(raw);
  if (value === null || value < 0n) {
    problems.push({ path, message: 'A plain non-negative amount, like 5000 or 5000.00.' });
    return null;
  }
  if (options.positive && value === 0n) {
    problems.push({ path, message: 'Must be more than zero.' });
    return null;
  }
  if (unit !== null && value % unit !== 0n) problems.push({ path, message: 'Must be a whole number of the book’s rounding unit.' });
  return value;
}

function allowance(problems: PriceBookProblem[], path: string, value: PriceBookAllowance, unit: bigint | null): void {
  if (!Number.isInteger(value.documents) || value.documents < 0) problems.push({ path: `${path}.documents`, message: 'A whole number of documents.' });
  amount(problems, `${path}.aiBudget`, value.aiBudget, unit);
}

/**
 * Everything wrong with a book, or nothing. The footguns: bands that do not ascend, a basis-point
 * value out of bounds, a cap that is not positive, amounts finer than the currency allows.
 */
export function priceBookProblems(book: PriceBook): PriceBookProblem[] {
  const problems: PriceBookProblem[] = [];
  if (!isCurrencyCode(book.currency)) problems.push({ path: 'currency', message: 'An ISO 4217 code, like USD.' });
  if (!Number.isInteger(book.version) || book.version < 1) problems.push({ path: 'version', message: 'Versions start at 1.' });
  if (Number.isNaN(Date.parse(book.effectiveFrom))) problems.push({ path: 'effectiveFrom', message: 'A date and time.' });

  let unit = toScaled(book.rounding);
  if (unit === null || unit <= 0n) {
    problems.push({ path: 'rounding', message: 'A positive unit, like 0.01 or 1.' });
    unit = null;
  } else if (isCurrencyCode(book.currency) && unit % (FACTOR / 10n ** BigInt(Math.min(currencyMinorUnits(book.currency), 6))) !== 0n) {
    problems.push({ path: 'rounding', message: `Finer than ${book.currency} allows.` });
  }

  amount(problems, 'fixedFee', book.fixedFee, unit);
  amount(problems, 'variableCap', book.variableCap, unit, { positive: true });
  amount(problems, 'pilotFlat', book.pilotFlat, unit);
  allowance(problems, 'baseIncludes', book.baseIncludes, unit);

  const maxBps = toScaled(MAX_BAND_BPS) ?? 0n;
  if (book.bands.length === 0) problems.push({ path: 'bands', message: 'At least one band.' });
  let previous = 0n;
  book.bands.forEach((band, index) => {
    const path = `bands.${index}`;
    const last = index === book.bands.length - 1;
    if (band.upTo === null) {
      if (!last) problems.push({ path: `${path}.upTo`, message: 'Only the last band is open-ended.' });
    } else {
      if (last) problems.push({ path: `${path}.upTo`, message: 'The last band is open-ended.' });
      const upTo = amount(problems, `${path}.upTo`, band.upTo, unit, { positive: true });
      if (upTo !== null) {
        if (upTo <= previous) problems.push({ path: `${path}.upTo`, message: 'Bands must ascend.' });
        previous = upTo;
      }
    }
    const bps = toScaled(band.bps);
    if (bps === null || bps < 0n || bps > maxBps) problems.push({ path: `${path}.bps`, message: `Between 0 and ${MAX_BAND_BPS} basis points.` });
    allowance(problems, `${path}.includes`, band.includes, unit);
  });
  return problems;
}

export class PriceBookError extends Error {
  constructor(readonly problems: PriceBookProblem[]) {
    super(`Invalid price book: ${problems.map((problem) => `${problem.path}: ${problem.message}`).join('; ')}`);
  }
}

export function assertPriceBook(book: PriceBook): void {
  const problems = priceBookProblems(book);
  if (problems.length > 0) throw new PriceBookError(problems);
}

/**
 * The version that prices a quote made at `at`, in `currency`: the latest that has taken effect.
 * Null when that market has no book yet (the quote is refused, never priced off another book).
 */
export function liveBook<T extends Pick<PriceBook, 'currency' | 'version' | 'effectiveFrom'>>(books: readonly T[], currency: string, at: Date): T | null {
  let live: T | null = null;
  for (const book of books) {
    if (book.currency !== currency || Date.parse(book.effectiveFrom) > at.getTime()) continue;
    if (!live || Date.parse(book.effectiveFrom) > Date.parse(live.effectiveFrom) || (book.effectiveFrom === live.effectiveFrom && book.version > live.version)) live = book;
  }
  return live;
}

/** A suggested starting point for a new market's book, with the rate and its date shown. Never live. */
export interface SuggestedPriceBook {
  book: PriceBook;
  suggestedFrom: { currency: string; version: number; rate: string; rateDate: string };
}

/**
 * Converts a book at a stated rate, rounding every amount to the target's unit (half to even), so
 * Kumar has a starting point to edit and confirm. Pactlab never derives or updates a live book this
 * way: the result is a draft, and the rate and date travel with it (T-170's rule, applied to pricing).
 */
export function suggestConvertedBook(source: PriceBook, target: { currency: string; rate: string; rateDate: string; rounding: string; effectiveFrom: string }): SuggestedPriceBook {
  const rate = toScaled(target.rate);
  const unit = toScaled(target.rounding);
  if (rate === null || rate <= 0n) throw new PriceBookError([{ path: 'rate', message: 'A positive rate.' }]);
  if (unit === null || unit <= 0n) throw new PriceBookError([{ path: 'rounding', message: 'A positive unit.' }]);
  const decimals = Math.min(currencyMinorUnits(target.currency), 6);
  const convert = (raw: string): string => {
    const value = toScaled(raw) ?? 0n;
    return fromScaled(roundToUnit(value * rate, 1n, unit), decimals);
  };
  const includes = (value: PriceBookAllowance): PriceBookAllowance => ({ documents: value.documents, aiBudget: convert(value.aiBudget) });
  return {
    book: {
      currency: target.currency,
      version: 1,
      effectiveFrom: target.effectiveFrom,
      fixedFee: convert(source.fixedFee),
      baseIncludes: includes(source.baseIncludes),
      bands: source.bands.map((band) => ({ upTo: band.upTo === null ? null : convert(band.upTo), bps: band.bps, includes: includes(band.includes) })),
      variableCap: convert(source.variableCap),
      pilotFlat: convert(source.pilotFlat),
      rounding: target.rounding,
    },
    suggestedFrom: { currency: source.currency, version: source.version, rate: target.rate, rateDate: target.rateDate },
  };
}
