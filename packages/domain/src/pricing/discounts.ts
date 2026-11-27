import { currencyMinorUnits } from '../money/currencies';
import { fromScaled, roundToUnit, toScaled } from './decimal';
import type { PactQuote } from './quote';

/**
 * Checkout discounts (T-177 sections 8–10, 14). Two codes, kept distinct: a partner (reseller) code is
 * attribution and carries T-093's first-year discount; a promo code changes price. By default they do
 * not stack: checkout applies the single better discount and says which won. A promo marked
 * stackable combines: the promo first, then the reseller percentage on what remains.
 */
export type PromoEffect =
  | { kind: 'PERCENT_TOTAL'; percent: string }
  | { kind: 'PERCENT_FIXED'; percent: string }
  | { kind: 'AMOUNT_OFF'; amount: string; currency: string }
  | { kind: 'WAIVE_VARIABLE' }
  | { kind: 'PILOT_FLAT'; pilotFlat: string };

export interface CheckoutPromo {
  code: string;
  effect: PromoEffect;
  stackable: boolean;
  /** Book currencies the code is valid on; empty for a global code. */
  markets: readonly string[];
}

export type PromoRefusal = 'WRONG_MARKET' | 'WRONG_CURRENCY' | 'PILOT_ALREADY_FLAT';

/** Whether a promo can price this quote at all, before dates, limits and org scope (stored state). */
export function promoRefusal(promo: CheckoutPromo, quote: PactQuote): PromoRefusal | null {
  if (promo.markets.length > 0 && !promo.markets.includes(quote.currency)) return 'WRONG_MARKET';
  if (promo.effect.kind === 'AMOUNT_OFF' && promo.effect.currency !== quote.currency) return 'WRONG_CURRENCY';
  if (promo.effect.kind === 'PILOT_FLAT' && quote.pilot) return 'PILOT_ALREADY_FLAT';
  return null;
}

export interface CheckoutPrice {
  currency: string;
  /** The quote's total, before any discount. */
  subtotal: string;
  reseller: { percent: string; amount: string; applied: boolean } | null;
  promo: { code: string; amount: string; applied: boolean; refusal: PromoRefusal | null } | null;
  /** Which discount won, or both when the promo stacks. */
  applied: 'NONE' | 'RESELLER' | 'PROMO' | 'BOTH';
  /** What is collected: commissions (T-093) accrue on this. */
  total: string;
}

function percentOf(base: bigint, percent: string, unit: bigint): bigint {
  const rate = toScaled(percent);
  if (rate === null || rate <= 0n || rate > 100n * 1_000_000n) throw new RangeError('A percentage above 0 and at most 100.');
  return roundToUnit(base * rate, 100n, unit);
}

function promoAmount(effect: PromoEffect, quote: PactQuote, base: bigint, unit: bigint): bigint {
  const of = (raw: string) => toScaled(raw) ?? 0n;
  const amount = (() => {
    switch (effect.kind) {
      case 'PERCENT_TOTAL':
        return percentOf(base, effect.percent, unit);
      case 'PERCENT_FIXED':
        return percentOf(of(quote.fixed), effect.percent, unit);
      case 'AMOUNT_OFF':
        return of(effect.amount);
      case 'WAIVE_VARIABLE':
        return of(quote.variable.amount);
      case 'PILOT_FLAT':
        return base - of(effect.pilotFlat);
    }
  })();
  return amount < 0n ? 0n : amount > base ? base : amount;
}

/** Applies the codes a buyer arrived with to a quote. Every amount is in the quote's currency. */
export function priceCheckout(quote: PactQuote, codes: { resellerPercent?: string | null; promo?: CheckoutPromo | null }, rounding: string): CheckoutPrice {
  const unit = toScaled(rounding) ?? 1n;
  const show = (value: bigint) => fromScaled(value, Math.min(currencyMinorUnits(quote.currency), 6));
  const subtotal = toScaled(quote.total) ?? 0n;

  const refusal = codes.promo ? promoRefusal(codes.promo, quote) : null;
  const promoAlone = codes.promo && !refusal ? promoAmount(codes.promo.effect, quote, subtotal, unit) : null;
  const resellerAlone = codes.resellerPercent ? percentOf(subtotal, codes.resellerPercent, unit) : null;

  let applied: CheckoutPrice['applied'] = 'NONE';
  let promoTaken = 0n;
  let resellerTaken = 0n;
  if (promoAlone !== null && resellerAlone !== null && codes.promo?.stackable) {
    applied = 'BOTH';
    promoTaken = promoAlone;
    resellerTaken = percentOf(subtotal - promoAlone, codes.resellerPercent ?? '0', unit);
  } else if (promoAlone !== null && resellerAlone !== null) {
    // The single better discount; on a tie the partner's, which the buyer is owed by arriving with it.
    if (promoAlone > resellerAlone) {
      applied = 'PROMO';
      promoTaken = promoAlone;
    } else {
      applied = 'RESELLER';
      resellerTaken = resellerAlone;
    }
  } else if (promoAlone !== null) {
    applied = 'PROMO';
    promoTaken = promoAlone;
  } else if (resellerAlone !== null) {
    applied = 'RESELLER';
    resellerTaken = resellerAlone;
  }

  return {
    currency: quote.currency,
    subtotal: show(subtotal),
    reseller: codes.resellerPercent ? { percent: codes.resellerPercent, amount: show(applied === 'BOTH' ? resellerTaken : (resellerAlone ?? 0n)), applied: applied === 'RESELLER' || applied === 'BOTH' } : null,
    promo: codes.promo ? { code: codes.promo.code, amount: show(applied === 'BOTH' ? promoTaken : (promoAlone ?? 0n)), applied: applied === 'PROMO' || applied === 'BOTH', refusal } : null,
    applied,
    total: show(subtotal - promoTaken - resellerTaken),
  };
}
