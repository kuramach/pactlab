import { currencyMinorUnits } from '../money/currencies';
import type { PriceBookAllowance } from './book';
import { fromScaled, toScaled } from './decimal';
import type { CheckoutPrice, CheckoutPromo, PromoEffect, PromoRefusal } from './discounts';
import type { PactQuote } from './quote';

/**
 * Stored quotes (T-177a, ADR 0061): a quote is kept as its itemized lines, the lines checkout turns
 * into Stripe items, and re-shown from them, never recomputed. A new book version therefore cannot
 * change a quote already made. The engine version is stored with every quote.
 */
export const PRICING_ENGINE_VERSION = 'pricing-1';

export type StoredQuoteLineKind = 'FIXED' | 'BAND' | 'PROMO' | 'RESELLER';

export interface StoredQuoteLine {
  kind: StoredQuoteLineKind;
  from: string | null;
  upTo: string | null;
  bps: string | null;
  slice: string | null;
  percent: string | null;
  amount: string;
  /** A discount that lost to the other (they do not stack by default) is kept, unapplied. */
  applied: boolean;
}

const line = (kind: StoredQuoteLineKind, amount: string, extra: Partial<StoredQuoteLine> = {}): StoredQuoteLine => ({ kind, from: null, upTo: null, bps: null, slice: null, percent: null, amount, applied: true, ...extra });

/** The lines a quote and its checkout price are stored as: the fixed fee, each band, each discount. */
export function quoteLines(quote: PactQuote, price: CheckoutPrice): StoredQuoteLine[] {
  const lines = [line('FIXED', quote.fixed)];
  for (const band of quote.variable.bands) lines.push(line('BAND', band.amount, { from: band.from, upTo: band.upTo, bps: band.bps, slice: band.slice }));
  if (price.promo && price.promo.refusal === null) lines.push(line('PROMO', price.promo.amount, { applied: price.promo.applied }));
  if (price.reseller) lines.push(line('RESELLER', price.reseller.amount, { percent: price.reseller.percent, applied: price.reseller.applied }));
  return lines;
}

export interface StoredQuoteHeader {
  currency: string;
  bookVersion: number;
  pilot: boolean;
  enterpriseValue: string | null;
  /** The book version's cap, which says whether the variable was capped. */
  variableCap: string;
  subtotal: string;
  total: string;
  applied: CheckoutPrice['applied'];
  includes: PriceBookAllowance;
  promoCode: string | null;
  promoRefusal: string | null;
  lines: readonly StoredQuoteLine[];
}

/** A stored quote back as the engine showed it when it was made. */
export function reshowQuote(stored: StoredQuoteHeader): { quote: PactQuote; price: CheckoutPrice } {
  const places = Math.min(currencyMinorUnits(stored.currency), 6);
  const of = (raw: string | null) => (raw === null ? 0n : (toScaled(raw) ?? 0n));
  const show = (value: bigint) => fromScaled(value, places);
  const fixed = of(stored.lines.find((entry) => entry.kind === 'FIXED')?.amount ?? null);
  const bands = stored.lines.filter((entry) => entry.kind === 'BAND');
  const uncapped = bands.reduce((sum, band) => sum + of(band.amount), 0n);
  const cap = of(stored.variableCap);
  const subtotal = of(stored.subtotal);
  const promo = stored.lines.find((entry) => entry.kind === 'PROMO');
  const reseller = stored.lines.find((entry) => entry.kind === 'RESELLER');
  return {
    quote: {
      currency: stored.currency,
      bookVersion: stored.bookVersion,
      pilot: stored.pilot,
      enterpriseValue: stored.enterpriseValue,
      fixed: show(fixed),
      variable: {
        bands: bands.map((band) => ({ from: band.from ?? show(0n), upTo: band.upTo, bps: band.bps ?? '0', slice: band.slice ?? show(0n), amount: band.amount })),
        uncapped: show(uncapped),
        capped: !stored.pilot && uncapped > cap,
        cap: show(cap),
        amount: show(subtotal - fixed),
      },
      total: show(subtotal),
      includes: stored.includes,
    },
    price: {
      currency: stored.currency,
      subtotal: show(subtotal),
      reseller: reseller ? { percent: reseller.percent ?? '0', amount: reseller.amount, applied: reseller.applied } : null,
      promo: stored.promoCode ? { code: stored.promoCode, amount: promo?.amount ?? show(0n), applied: promo?.applied ?? false, refusal: (stored.promoRefusal as PromoRefusal | null) ?? null } : null,
      applied: stored.applied,
      total: stored.total,
    },
  };
}

/** A stored promo's effect as the engine reads it. */
export function checkoutPromo(promo: { code: string; effect: PromoEffect['kind']; percent: string | null; amount: string | null; pilotFlat: string | null; currency: string | null; markets: readonly string[]; stackable: boolean }): CheckoutPromo {
  const effect = ((): PromoEffect => {
    switch (promo.effect) {
      case 'PERCENT_TOTAL':
      case 'PERCENT_FIXED':
        return { kind: promo.effect, percent: promo.percent ?? '0' };
      case 'AMOUNT_OFF':
        return { kind: 'AMOUNT_OFF', amount: promo.amount ?? '0', currency: promo.currency ?? '' };
      case 'WAIVE_VARIABLE':
        return { kind: 'WAIVE_VARIABLE' };
      case 'PILOT_FLAT':
        return { kind: 'PILOT_FLAT', pilotFlat: promo.pilotFlat ?? '0' };
    }
  })();
  return { code: promo.code, effect, stackable: promo.stackable, markets: promo.markets };
}
