import { describe, expect, it } from 'vitest';
import { describeGap, describeStaleReason, freshness, isSubtotal, parseDealParam, statusVariant } from './view';

describe('valuation view helpers', () => {
  it('accepts only a UUID deal id', () => {
    const deal = '01890a5d-ac96-774b-bcce-b302099a8057';
    expect(parseDealParam(deal)).toBe(deal);
    expect(parseDealParam([deal, 'x'])).toBe(deal);
    expect(parseDealParam('../deals')).toBeUndefined();
    expect(parseDealParam(undefined)).toBeUndefined();
  });

  it('labels freshness and stale reasons', () => {
    expect(freshness({ stale: null }).label).toBe('Not run');
    expect(freshness({ stale: false }).variant).toBe('calculation');
    expect(freshness({ stale: true }).variant).toBe('danger');
    expect(
      describeStaleReason({
        kind: 'FINDING_CHANGED',
        findingId: '0190f000-0000-7000-8000-00000000000a',
      }),
    ).toBe('A linked accepted risk was re-priced (finding 0190f000)');
    expect(describeStaleReason({ kind: 'ASSUMPTIONS_CHANGED' })).toBe(
      'Assumptions changed since the last run',
    );
  });

  it('maps statuses and bridge subtotals', () => {
    expect(statusVariant('APPROVED')).toBe('reviewed');
    expect(statusVariant('SUBMITTED')).toBe('neutral');
    expect(isSubtotal({ kind: 'EQUITY_PURCHASE_PRICE' })).toBe(true);
    expect(isSubtotal({ kind: 'FINDING_ADJUSTMENT' })).toBe(false);
  });
});

describe('describeGap', () => {
  const side = (gapRatio: string, verdict: 'BELOW' | 'AT' | 'ABOVE') => ({ value: { amount: '0', currency: 'USD' }, gap: { amount: '0', currency: 'USD' }, gapRatio, verdict });
  it('turns signed ratios into plain words', () => {
    expect(describeGap(side('-0.1250', 'BELOW'))).toBe('12.5% below asking');
    expect(describeGap(side('0.0714', 'ABOVE'))).toBe('7.14% above asking');
    expect(describeGap(side('-1.5000', 'BELOW'))).toBe('150% below asking');
    expect(describeGap(side('0.0000', 'AT'))).toBe('at the asking price');
  });
});
