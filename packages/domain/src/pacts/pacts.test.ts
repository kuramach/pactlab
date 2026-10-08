import { describe, expect, it } from 'vitest';
import { COMPANY_TYPES, deriveTransactionType, sourceKindForProvider, sourcesFor } from '.';

describe('deriveTransactionType', () => {
  it.each([
    ['PUBLIC', 'PUBLIC', 'PUBLIC_ACQUIRER'],
    ['PUBLIC', 'PRIVATE', 'PUBLIC_ACQUIRER'],
    ['PRIVATE', 'PUBLIC', 'TAKE_PRIVATE'],
    ['PRIVATE', 'PRIVATE', 'PRIVATE_ACQUIRER'],
  ] as const)('%s buyer, %s seller → %s', (buyer, seller, expected) => {
    expect(deriveTransactionType({ ownership: buyer }, { ownership: seller })).toBe(expected);
  });
});

describe('sourcesFor', () => {
  it('switches on billing, code, delivery and documents for a software seller', () => {
    const plan = sourcesFor('SOFTWARE_SAAS');
    expect(plan.packAvailable).toBe(true);
    expect(plan.note).toBeNull();
    expect(plan.sources.map((source) => [source.kind, source.providerLabel])).toEqual([
      ['BILLING', 'Stripe'],
      ['CODE', 'GitHub'],
      ['DELIVERY', 'Jira'],
      ['DOCUMENTS', 'Data room'],
    ]);
  });

  it('never claims an industry pack that is not built', () => {
    for (const type of COMPANY_TYPES.filter((type) => type !== 'SOFTWARE_SAAS')) {
      const plan = sourcesFor(type);
      expect(plan.packAvailable).toBe(false);
      expect(plan.note).toBeTruthy();
      expect(plan.sources.length).toBeGreaterThan(0);
      expect(plan.sources.map((source) => source.kind)).toContain('DOCUMENTS');
    }
  });

  it('offers an API for every source and uploads only for billing and documents', () => {
    const methods = Object.fromEntries(
      sourcesFor('SOFTWARE_SAAS').sources.map((source) => [source.kind, [Object.keys(source.availability).sort(), source.upload?.format ?? null]]),
    );
    expect(methods).toEqual({
      BILLING: [['API', 'UPLOAD'], 'CSV'],
      CODE: [['API'], null],
      DELIVERY: [['API'], null],
      DOCUMENTS: [['API', 'UPLOAD'], 'FILES'],
    });
    expect(sourcesFor('SOFTWARE_SAAS').sources[0]!.availability.UPLOAD).toBe('AVAILABLE');
  });

  it('maps existing connection providers onto sources', () => {
    expect(sourceKindForProvider('csv')).toBe('BILLING');
    expect(sourceKindForProvider('stripe')).toBe('BILLING');
    expect(sourceKindForProvider('billing_upload')).toBe('BILLING');
    expect(sourceKindForProvider('github')).toBe('CODE');
    expect(sourceKindForProvider('jira')).toBe('DELIVERY');
    expect(sourceKindForProvider('unknown')).toBeNull();
  });
});
