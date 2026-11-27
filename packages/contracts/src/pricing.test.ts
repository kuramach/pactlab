import { describe, expect, it } from 'vitest';
import { pactQuoteRequestSchema, priceBookSchema } from './pricing';

const book = {
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

describe('priceBookSchema', () => {
  it('accepts a valid book', () => {
    expect(priceBookSchema.safeParse(book).success).toBe(true);
  });

  it('carries the domain’s checks to the field that is wrong', () => {
    const result = priceBookSchema.safeParse({ ...book, bands: [book.bands[1], book.bands[0], book.bands[2]] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['bands', 1, 'upTo']]);
  });

  it('rejects unknown fields and floats', () => {
    expect(priceBookSchema.safeParse({ ...book, discount: '10' }).success).toBe(false);
    expect(priceBookSchema.safeParse({ ...book, fixedFee: 5000 }).success).toBe(false);
  });
});

describe('pactQuoteRequestSchema', () => {
  it('keeps the partner and promo codes as separate fields', () => {
    expect(pactQuoteRequestSchema.parse({ currency: 'JPY', enterpriseValue: '10000000000' })).toEqual({ currency: 'JPY', enterpriseValue: '10000000000', partnerCode: null, promoCode: null });
    expect(pactQuoteRequestSchema.safeParse({ currency: 'USD', enterpriseValue: '1', code: 'X' }).success).toBe(false);
  });
});
