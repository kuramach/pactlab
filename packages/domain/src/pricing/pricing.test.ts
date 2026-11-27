import { describe, expect, it } from 'vitest';
import { liveBook, priceBookProblems, suggestConvertedBook, type PriceBook } from './book';
import { priceCheckout, type CheckoutPromo } from './discounts';
import { quotePact } from './quote';
import { checkoutPromo, quoteLines, reshowQuote } from './stored';

/** Kumar's schedule (2026-11-26) as a stored book would hold it; a test fixture, never a code default. */
const USD: PriceBook = {
  currency: 'USD',
  version: 1,
  effectiveFrom: '2026-12-01T00:00:00Z',
  fixedFee: '5000',
  baseIncludes: { documents: 500, aiBudget: '50' },
  bands: [
    { upTo: '25000000', bps: '5', includes: { documents: 1000, aiBudget: '100' } },
    { upTo: '100000000', bps: '2', includes: { documents: 2500, aiBudget: '250' } },
    { upTo: null, bps: '1', includes: { documents: 5000, aiBudget: '500' } },
  ],
  variableCap: '50000',
  pilotFlat: '5000',
  rounding: '0.01',
};

const JPY: PriceBook = {
  currency: 'JPY',
  version: 1,
  effectiveFrom: '2026-12-01T00:00:00Z',
  fixedFee: '750000',
  baseIncludes: { documents: 500, aiBudget: '7500' },
  bands: [
    { upTo: '3750000000', bps: '5', includes: { documents: 1000, aiBudget: '15000' } },
    { upTo: '15000000000', bps: '2', includes: { documents: 2500, aiBudget: '37500' } },
    { upTo: null, bps: '1', includes: { documents: 5000, aiBudget: '75000' } },
  ],
  variableCap: '7500000',
  pilotFlat: '750000',
  rounding: '1',
};

describe('quotePact: the worked totals at the band edges', () => {
  const cases: [string, string, string][] = [
    ['10000000', '5000.00', '10000.00'],
    ['25000000', '12500.00', '17500.00'],
    ['50000000', '17500.00', '22500.00'],
    ['100000000', '27500.00', '32500.00'],
    ['250000000', '42500.00', '47500.00'],
    ['500000000', '50000.00', '55000.00'],
  ];
  for (const [ev, variable, total] of cases) {
    it(`USD ${ev}`, () => {
      const quote = quotePact(USD, { enterpriseValue: ev });
      expect(quote.fixed).toBe('5000.00');
      expect(quote.variable.amount).toBe(variable);
      expect(quote.total).toBe(total);
    });
  }

  it('itemizes a $100M pact: $5,000 fixed + $27,500 variable, by band', () => {
    const quote = quotePact(USD, { enterpriseValue: '100000000' });
    expect(quote.variable.bands).toEqual([
      { from: '0.00', upTo: '25000000.00', bps: '5', slice: '25000000.00', amount: '12500.00' },
      { from: '25000000.00', upTo: '100000000.00', bps: '2', slice: '75000000.00', amount: '15000.00' },
    ]);
    expect(quote.variable.capped).toBe(false);
    expect(quote.includes).toEqual({ documents: 2500, aiBudget: '250' });
  });

  it('caps the variable at $50,000 and says so', () => {
    const quote = quotePact(USD, { enterpriseValue: '500000000' });
    expect(quote.variable.uncapped).toBe('67500.00');
    expect(quote.variable.capped).toBe(true);
    expect(quote.includes).toEqual({ documents: 5000, aiBudget: '500' });
  });

  it('quotes the pilot flat at every size', () => {
    for (const ev of ['10000000', '100000000', '500000000', null]) {
      const quote = quotePact(USD, { enterpriseValue: ev, pilot: true });
      expect(quote.total).toBe('5000.00');
      expect(quote.variable.amount).toBe('0.00');
      expect(quote.variable.bands).toEqual([]);
    }
  });

  it('a deal of no stated value pays the fixed fee only', () => {
    expect(quotePact(USD, { enterpriseValue: null }).total).toBe('5000.00');
    expect(quotePact(USD, { enterpriseValue: '0' }).includes).toEqual(USD.baseIncludes);
  });

  it('rounds each band line half to even, and the lines foot', () => {
    const quote = quotePact(USD, { enterpriseValue: '25000010.25' });
    // 25,000,000 × 5 bps = 12,500; 10.25 × 2 bps = 0.00205 → 0.00.
    expect(quote.variable.bands.map((band) => band.amount)).toEqual(['12500.00', '0.00']);
    expect(quote.variable.amount).toBe('12500.00');
  });

  it('a changed bps value in the book changes the quote, with no code change', () => {
    const tuned: PriceBook = { ...USD, version: 2, bands: USD.bands.map((band, index) => (index === 1 ? { ...band, bps: '3' } : band)) };
    expect(quotePact(tuned, { enterpriseValue: '100000000' }).total).toBe('40000.00');
  });

  it('prices a ¥10B pact off the JPY book in whole yen', () => {
    const quote = quotePact(JPY, { enterpriseValue: '10000000000' });
    expect(quote.currency).toBe('JPY');
    // 3.75B × 5 bps = 1,875,000; 6.25B × 2 bps = 1,250,000.
    expect(quote.variable.amount).toBe('3125000');
    expect(quote.total).toBe('3875000');
    expect(quote.bookVersion).toBe(1);
  });

  it('refuses an invalid book or enterprise value', () => {
    expect(() => quotePact({ ...USD, variableCap: '0' }, { enterpriseValue: '1' })).toThrow(/variableCap/);
    expect(() => quotePact(USD, { enterpriseValue: '-5' })).toThrow();
    expect(() => quotePact(USD, { enterpriseValue: '1e9' })).toThrow();
  });
});

describe('priceBookProblems: the footguns', () => {
  it('accepts the launch books', () => {
    expect(priceBookProblems(USD)).toEqual([]);
    expect(priceBookProblems(JPY)).toEqual([]);
  });

  it('refuses bands that do not ascend, bps out of bounds, a cap that is not positive', () => {
    const paths = priceBookProblems({
      ...USD,
      variableCap: '0',
      bands: [
        { upTo: '100000000', bps: '5', includes: USD.baseIncludes },
        { upTo: '25000000', bps: '250', includes: USD.baseIncludes },
        { upTo: null, bps: '-1', includes: USD.baseIncludes },
      ],
    }).map((problem) => problem.path);
    expect(paths).toEqual(['variableCap', 'bands.1.upTo', 'bands.1.bps', 'bands.2.bps']);
  });

  it('refuses an open band before the last, a closed last band, and no bands', () => {
    expect(priceBookProblems({ ...USD, bands: [{ upTo: null, bps: '5', includes: USD.baseIncludes }, { upTo: '5', bps: '1', includes: USD.baseIncludes }] }).map((p) => p.path)).toEqual(['bands.0.upTo', 'bands.1.upTo']);
    expect(priceBookProblems({ ...USD, bands: [] }).map((p) => p.path)).toEqual(['bands']);
  });

  it('refuses amounts finer than the currency or the book’s rounding', () => {
    expect(priceBookProblems({ ...JPY, rounding: '0.01' }).map((p) => p.path)).toEqual(['rounding']);
    expect(priceBookProblems({ ...JPY, fixedFee: '750000.5' }).map((p) => p.path)).toEqual(['fixedFee']);
  });
});

describe('liveBook: quotes bind to the version live at quote time', () => {
  const v2 = { ...USD, version: 2, effectiveFrom: '2027-01-01T00:00:00Z', fixedFee: '6000' };
  const eur = { ...USD, currency: 'EUR', version: 7, effectiveFrom: '2026-06-01T00:00:00Z' };
  const books = [USD, v2, eur];

  it('picks the latest version that has taken effect, per currency', () => {
    expect(liveBook(books, 'USD', new Date('2026-12-15T00:00:00Z'))?.version).toBe(1);
    expect(liveBook(books, 'USD', new Date('2027-01-02T00:00:00Z'))?.version).toBe(2);
    expect(liveBook(books, 'EUR', new Date('2027-01-02T00:00:00Z'))?.version).toBe(7);
  });

  it('has no book for a market without one, and none before the first takes effect', () => {
    expect(liveBook(books, 'JPY', new Date('2027-01-02T00:00:00Z'))).toBeNull();
    expect(liveBook(books, 'USD', new Date('2026-11-01T00:00:00Z'))).toBeNull();
  });

  it('an in-flight quote keeps its price: it was made on the earlier version', () => {
    const quoted = quotePact(liveBook(books, 'USD', new Date('2026-12-31T00:00:00Z'))!, { enterpriseValue: '100000000' });
    const fresh = quotePact(liveBook(books, 'USD', new Date('2027-01-02T00:00:00Z'))!, { enterpriseValue: '100000000' });
    expect([quoted.total, fresh.total]).toEqual(['32500.00', '33500.00']);
  });
});

describe('suggestConvertedBook: a starting point, never a live book', () => {
  it('converts at the stated rate, rounds to the target unit and carries the rate and date', () => {
    const suggested = suggestConvertedBook(USD, { currency: 'INR', rate: '84.12', rateDate: '2026-11-26', rounding: '1', effectiveFrom: '2027-01-01T00:00:00Z' });
    expect(suggested.book.fixedFee).toBe('420600.00');
    expect(suggested.book.bands[0]?.upTo).toBe('2103000000.00');
    expect(suggested.book.bands[0]?.bps).toBe('5');
    expect(suggested.suggestedFrom).toEqual({ currency: 'USD', version: 1, rate: '84.12', rateDate: '2026-11-26' });
    expect(priceBookProblems(suggested.book)).toEqual([]);
  });
});

describe('priceCheckout: two codes, the better single discount', () => {
  const quote = quotePact(USD, { enterpriseValue: '100000000' });
  const promo = (effect: CheckoutPromo['effect'], extra: Partial<CheckoutPromo> = {}): CheckoutPromo => ({ code: 'LAUNCH20', effect, stackable: false, markets: [], ...extra });

  it('applies the reseller 10% to the total', () => {
    const price = priceCheckout(quote, { resellerPercent: '10' }, USD.rounding);
    expect(price).toMatchObject({ subtotal: '32500.00', applied: 'RESELLER', total: '29250.00', reseller: { amount: '3250.00', applied: true } });
  });

  it('20% off with a reseller code: the promo wins, both effects itemized', () => {
    const price = priceCheckout(quote, { resellerPercent: '10', promo: promo({ kind: 'PERCENT_TOTAL', percent: '20' }) }, USD.rounding);
    expect(price.applied).toBe('PROMO');
    expect(price.promo).toEqual({ code: 'LAUNCH20', amount: '6500.00', applied: true, refusal: null });
    expect(price.reseller).toEqual({ percent: '10', amount: '3250.00', applied: false });
    expect(price.total).toBe('26000.00');
  });

  it('a smaller promo loses to the reseller discount', () => {
    const price = priceCheckout(quote, { resellerPercent: '10', promo: promo({ kind: 'PERCENT_FIXED', percent: '50' }) }, USD.rounding);
    expect([price.applied, price.promo?.amount, price.total]).toEqual(['RESELLER', '2500.00', '29250.00']);
  });

  it('a stackable promo combines: promo first, then the reseller on the rest', () => {
    const price = priceCheckout(quote, { resellerPercent: '10', promo: promo({ kind: 'WAIVE_VARIABLE' }, { stackable: true }) }, USD.rounding);
    expect([price.applied, price.promo?.amount, price.reseller?.amount, price.total]).toEqual(['BOTH', '27500.00', '500.00', '4500.00']);
  });

  it('fixed amount off and pilot-flat override, never below zero', () => {
    expect(priceCheckout(quote, { promo: promo({ kind: 'AMOUNT_OFF', amount: '1000', currency: 'USD' }) }, USD.rounding).total).toBe('31500.00');
    expect(priceCheckout(quote, { promo: promo({ kind: 'PILOT_FLAT', pilotFlat: '5000' }) }, USD.rounding).total).toBe('5000.00');
    expect(priceCheckout(quote, { promo: promo({ kind: 'AMOUNT_OFF', amount: '99999', currency: 'USD' }) }, USD.rounding).total).toBe('0.00');
  });

  it('a JPY-scoped promo applies to a JPY quote; a USD-scoped one does not', () => {
    const yen = quotePact(JPY, { enterpriseValue: '10000000000' });
    const japan = priceCheckout(yen, { promo: promo({ kind: 'PERCENT_TOTAL', percent: '20' }, { code: 'JAPAN', markets: ['JPY'] }) }, JPY.rounding);
    expect([japan.applied, japan.total]).toEqual(['PROMO', '3100000']);
    const usOnly = priceCheckout(yen, { promo: promo({ kind: 'PERCENT_TOTAL', percent: '20' }, { markets: ['USD'] }) }, JPY.rounding);
    expect([usOnly.applied, usOnly.promo?.refusal, usOnly.total]).toEqual(['NONE', 'WRONG_MARKET', '3875000']);
    const dollarsOff = priceCheckout(yen, { promo: promo({ kind: 'AMOUNT_OFF', amount: '100', currency: 'USD' }) }, JPY.rounding);
    expect(dollarsOff.promo?.refusal).toBe('WRONG_CURRENCY');
  });

  it('no codes: the quote as it stands', () => {
    expect(priceCheckout(quote, {}, USD.rounding)).toMatchObject({ applied: 'NONE', total: '32500.00', reseller: null, promo: null });
  });
});

describe('stored quotes: kept as lines, re-shown exactly (T-177a)', () => {
  const reshow = (book: PriceBook, ev: string | null, pilot: boolean, promo: CheckoutPromo | null, resellerPercent: string | null = null) => {
    const quote = quotePact(book, { enterpriseValue: ev, pilot });
    const price = priceCheckout(quote, { promo, resellerPercent }, book.rounding);
    const lines = quoteLines(quote, price);
    const again = reshowQuote({ currency: book.currency, bookVersion: book.version, pilot, enterpriseValue: quote.enterpriseValue, variableCap: book.variableCap, subtotal: quote.total, total: price.total, applied: price.applied, includes: quote.includes, promoCode: promo?.code ?? null, promoRefusal: price.promo?.refusal ?? null, lines });
    return { quote, price, lines, again };
  };
  const cases: [string, PriceBook, string | null, boolean, CheckoutPromo | null, string | null][] = [
    ['a $100M pact, no codes', USD, '100000000', false, null, null],
    ['a capped $2B pact with a promo', USD, '2000000000', false, checkoutPromo({ code: 'TEN', effect: 'PERCENT_TOTAL', percent: '10', amount: null, pilotFlat: null, currency: null, markets: [], stackable: false }), null],
    ['a pilot', USD, null, true, null, null],
    ['a promo that loses to the reseller', USD, '100000000', false, checkoutPromo({ code: 'HALF', effect: 'PERCENT_FIXED', percent: '50', amount: null, pilotFlat: null, currency: null, markets: [], stackable: false }), '10'],
    ['a USD-scoped promo on a JPY quote', JPY, '15000000000', false, checkoutPromo({ code: 'US', effect: 'AMOUNT_OFF', percent: null, amount: '100', pilotFlat: null, currency: 'USD', markets: ['USD'], stackable: false }), null],
  ];
  for (const [name, book, ev, pilot, promo, reseller] of cases) {
    it(name, () => {
      const { quote, price, again } = reshow(book, ev, pilot, promo, reseller);
      expect(again.quote).toEqual(quote);
      expect(again.price).toEqual(price);
    });
  }

  it('stores one line for the fixed fee, one per band and one per discount', () => {
    const { lines } = reshow(USD, '100000000', false, checkoutPromo({ code: 'TEN', effect: 'WAIVE_VARIABLE', percent: null, amount: null, pilotFlat: null, currency: null, markets: [], stackable: false }));
    expect(lines.map((entry) => [entry.kind, entry.amount])).toEqual([['FIXED', '5000.00'], ['BAND', '12500.00'], ['BAND', '15000.00'], ['PROMO', '27500.00']]);
  });
});
