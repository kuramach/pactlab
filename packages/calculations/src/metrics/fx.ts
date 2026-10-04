import type Decimal from 'decimal.js';
import { D, parseDecimal } from './decimal';
import { daysBetween, isDate } from './months';
import type { Exclusion, FxRateInput, SourceRef } from './types';

/** ECB reference rates quote every currency against the euro. */
export const FX_BASE_CURRENCY = 'EUR';

/** A fixing older than this on the conversion date is stale, not silently reused. */
export const FX_MAX_AGE_DAYS = 7;

/** Recorded rates carry ten decimal places; converted = amount × recorded rate, exactly. */
export const FX_RATE_SCALE = 10;

interface Fixing {
  readonly rate: Decimal;
  readonly date: string;
  readonly source: string;
  readonly ref: SourceRef;
}

/** The rate actually used for one conversion; stored so every figure is re-derivable. */
export interface AppliedRate {
  readonly from: string;
  readonly to: string;
  readonly rate: string;
  /** Date of the oldest fixing the rate depends on. */
  readonly rateDate: string;
  readonly source: string;
  readonly refs: readonly SourceRef[];
}

export type RateLookup =
  | { readonly ok: true; readonly rate: AppliedRate }
  | {
      readonly ok: false;
      readonly reason: 'NO_FX_RATE' | 'STALE_FX_RATE';
      readonly detail: string;
    };

/**
 * Point-in-time conversion over cached reference rates. A conversion on a
 * date uses the latest fixing on or before that date — never a later one and
 * never a live lookup. Cross rates go through the euro.
 */
export class FxTable {
  private constructor(private readonly fixings: ReadonlyMap<string, readonly Fixing[]>) {}

  static fromRates(rates: readonly FxRateInput[]): { table: FxTable; issues: Exclusion[] } {
    const byCurrency = new Map<string, Fixing[]>();
    const issues: Exclusion[] = [];
    for (const input of rates) {
      const rate = parseDecimal(input.rate);
      const quote = input.quoteCurrency?.toUpperCase() ?? null;
      const valid =
        input.baseCurrency?.toUpperCase() === FX_BASE_CURRENCY &&
        quote !== null &&
        /^[A-Z]{3}$/.test(quote) &&
        rate !== null &&
        rate.greaterThan(0) &&
        isDate(input.rateDate);
      if (!valid || !quote || !rate || !input.rateDate) {
        issues.push({
          ref: input.ref,
          reason: 'INVALID_FX_RATE',
          detail: `Rate rows must be ${FX_BASE_CURRENCY}-based with a positive decimal rate and an ISO date`,
          customerId: null,
          month: null,
          monthlyAmount: null,
        });
        continue;
      }
      const list = byCurrency.get(quote) ?? [];
      list.push({ rate, date: input.rateDate, source: input.source ?? 'unknown', ref: input.ref });
      byCurrency.set(quote, list);
    }
    for (const list of byCurrency.values())
      list.sort(
        (a, b) => a.date.localeCompare(b.date) || a.ref.evidenceId.localeCompare(b.ref.evidenceId),
      );
    return { table: new FxTable(byCurrency), issues };
  }

  private fixing(currency: string, onDate: string): Fixing | null | 'EURO' {
    if (currency === FX_BASE_CURRENCY) return 'EURO';
    const list = this.fixings.get(currency) ?? [];
    let found: Fixing | null = null;
    for (const fixing of list) {
      if (fixing.date > onDate) break;
      found = fixing;
    }
    return found;
  }

  /** Rate to convert `from` into `to` as of `onDate`. */
  rate(from: string, to: string, onDate: string): RateLookup {
    if (from === to) {
      return {
        ok: true,
        rate: { from, to, rate: '1', rateDate: onDate, source: 'identity', refs: [] },
      };
    }
    const legs = [this.fixing(from, onDate), this.fixing(to, onDate)];
    const refs: SourceRef[] = [];
    let oldest = onDate;
    const sources = new Set<string>();
    for (const [index, leg] of legs.entries()) {
      if (leg === 'EURO') continue;
      const currency = index === 0 ? from : to;
      if (!leg)
        return {
          ok: false,
          reason: 'NO_FX_RATE',
          detail: `No ${FX_BASE_CURRENCY}/${currency} fixing on or before ${onDate}`,
        };
      if (daysBetween(leg.date, onDate) > FX_MAX_AGE_DAYS)
        return {
          ok: false,
          reason: 'STALE_FX_RATE',
          detail: `Latest ${FX_BASE_CURRENCY}/${currency} fixing (${leg.date}) is more than ${FX_MAX_AGE_DAYS} days before ${onDate}`,
        };
      refs.push(leg.ref);
      sources.add(leg.source);
      if (leg.date < oldest) oldest = leg.date;
    }
    const [fromLeg, toLeg] = legs as [Fixing | 'EURO', Fixing | 'EURO'];
    const fromRate = fromLeg === 'EURO' ? new D(1) : fromLeg.rate;
    const toRate = toLeg === 'EURO' ? new D(1) : toLeg.rate;
    return {
      ok: true,
      rate: {
        from,
        to,
        rate: toRate.dividedBy(fromRate).toFixed(FX_RATE_SCALE),
        rateDate: oldest,
        source: [...sources].sort().join('+'),
        refs,
      },
    };
  }
}
