import { describe, expect, it } from 'vitest';
import { compareToAsking, runValuation, type LinkedAdjustment, type ValuationInputs } from '.';

const PRICE = '0190f000-0000-7000-8000-00000000000b';
const ESCROW = '0190f000-0000-7000-8000-00000000000a';

const adjustments: LinkedAdjustment[] = [
  { findingId: PRICE, findingVersion: 2, type: 'PRICE_REDUCTION', currency: 'USD', low: '1000000', high: '3000000', point: 'MID', basis: 'Overstated ARR' },
  { findingId: ESCROW, findingVersion: 2, type: 'ESCROW', currency: 'USD', low: '500000', high: '500000', point: 'HIGH', basis: 'Licence exposure' },
];

function result(overrides: Partial<ValuationInputs> = {}) {
  return runValuation({
    currency: 'USD',
    transactionType: 'PRIVATE_ACQUIRER',
    assumptions: { method: 'ARR_MULTIPLE', arr: '10000000', multiple: '6.5' },
    bridge: { cash: '2000000', debt: '1000000', debtLikeItems: '0', workingCapitalAdjustment: '0' },
    stockConsiderationShare: '0',
    adjustments,
    lbo: null,
    accretionDilution: null,
    sensitivity: null,
    ...overrides,
  });
}

describe('compareToAsking', () => {
  it('tests an enterprise-value ask before and after accepted price reductions; escrows hold back cash, not price', () => {
    const comparison = compareToAsking(result(), { amount: '70000000', currency: 'USD', basis: 'ENTERPRISE_VALUE' });
    expect(comparison).toMatchObject({
      comparable: true,
      basis: 'ENTERPRISE_VALUE',
      asking: { amount: '70000000.00', currency: 'USD' },
      beforeRisks: { value: { amount: '65000000.00' }, gap: { amount: '-5000000.00' }, gapRatio: '-0.0714', verdict: 'BELOW' },
      afterRisks: { value: { amount: '63000000.00' }, gap: { amount: '-7000000.00' }, gapRatio: '-0.1000', verdict: 'BELOW' },
    });
    if (!comparison.comparable) throw new Error('expected comparable');
    expect(comparison.riskAdjustments).toEqual([{ findingId: PRICE, label: expect.any(String), amount: { amount: '-2000000.00', currency: 'USD' } }]);
    expect(comparison.holdbacks).toEqual([{ findingId: ESCROW, label: expect.any(String), amount: { amount: '-500000.00', currency: 'USD' } }]);
  });

  it('tests an equity-value ask against equity value and the equity purchase price', () => {
    // EV 65,000,000 + cash 2,000,000 − debt 1,000,000 = equity 66,000,000; minus the 2,000,000 reduction.
    const comparison = compareToAsking(result(), { amount: '60000000', currency: 'USD', basis: 'EQUITY_VALUE' });
    expect(comparison).toMatchObject({
      beforeRisks: { value: { amount: '66000000.00' }, gap: { amount: '6000000.00' }, gapRatio: '0.1000', verdict: 'ABOVE' },
      afterRisks: { value: { amount: '64000000.00' }, verdict: 'ABOVE' },
    });
  });

  it('reports a match exactly and never compares different currencies', () => {
    expect(compareToAsking(result({ adjustments: [] }), { amount: '65000000', currency: 'USD', basis: 'ENTERPRISE_VALUE' })).toMatchObject({
      beforeRisks: { verdict: 'AT', gapRatio: '0.0000' },
      afterRisks: { verdict: 'AT' },
    });
    expect(compareToAsking(result(), { amount: '65000000', currency: 'EUR', basis: 'ENTERPRISE_VALUE' })).toEqual({
      comparable: false,
      reason: 'CURRENCY',
    });
  });

  it('rejects floating-point amounts', () => {
    expect(() => compareToAsking(result(), { amount: 7e7 as unknown as string, currency: 'USD', basis: 'ENTERPRISE_VALUE' })).toThrow(/decimal strings/);
  });
});
