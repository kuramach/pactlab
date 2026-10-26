import { describe, expect, it } from 'vitest';
import { D } from '../metrics/decimal';
import { effectiveTerms, liquidationPreference, roundScenario, roundScenarios, RoundModelError, type CapTableRow } from './round';

const row = (securityId: string, holderType: CapTableRow['holderType'], instrument: CapTableRow['instrument'], values: Partial<Record<'shares' | 'principal' | 'cap' | 'discount', string>> & { mfn?: boolean; issuedOn?: string } = {}): CapTableRow => ({
  securityId,
  holderRef: securityId,
  holderType,
  instrument,
  shares: values.shares ? new D(values.shares) : null,
  principal: values.principal ? new D(values.principal) : null,
  valuationCap: values.cap ? new D(values.cap) : null,
  discount: values.discount ? new D(values.discount) : null,
  mfn: values.mfn ?? false,
  issuedOn: values.issuedOn ?? null,
});
const founders = [row('CS-1', 'founder', 'common', { shares: '6000000' }), row('CS-2', 'founder', 'common', { shares: '4000000' })];
const round = (preMoney: string, amount: string, poolTarget = '0') => ({ preMoney: new D(preMoney), amount: new D(amount), poolTarget: new D(poolTarget) });

describe('venture round model (T-083)', () => {
  it('a plain priced round: price, new shares and founder ownership', () => {
    const result = roundScenario(founders, round('10000000', '2500000'));
    expect(result).toMatchObject({ pricePerShare: '1.000000', newInvestorShares: '2500000', sharesAfter: '12500000', postMoney: '12500000.00', founders: { before: '100.00', after: '80.00' } });
    expect(result.poolShuffle).toMatchObject({ shares: '0', founderPointsLost: '0.00' });
  });

  it('the pool shuffle: a pre-money pool increase is paid by the founders, in shares and points', () => {
    const result = roundScenario(founders, round('10000000', '2500000', '0.10'));
    // y = 10m ÷ (1 − 0.10 × 1.25) = 11,428,571.43; price = 0.875; pool + 1,428,572; new 2,857,142.
    expect(result).toMatchObject({ pricePerShare: '0.875000', poolIncrease: '1428572', newInvestorShares: '2857142', sharesAfter: '14285714', founders: { after: '70.00' } });
    expect(result.poolShuffle.founderPointsLost).toBe('10.00');
    expect(result.poolShuffle.statement).toMatch(/^The pool grows by 1428572 shares before the money comes in, so existing holders pay for it: founders end 10\.00 points lower/);
    expect(Number(result.ownership.find((entry) => entry.holderType === 'pool')?.after)).toBeGreaterThanOrEqual(10);
  });

  it('a SAFE converts at its cap when the cap price is lower than the round price', () => {
    const rows = [...founders, row('SAFE-1', 'investor', 'safe', { principal: '1000000', cap: '4000000' })];
    const result = roundScenario(rows, round('8000000', '2000000'));
    // y = 10m ÷ 0.75; price 0.6; cap price 0.3 → 3,333,333 shares.
    expect(result.pricePerShare).toBe('0.600000');
    expect(result.conversions).toEqual([{ securityId: 'SAFE-1', instrument: 'safe', principal: '1000000.00', price: '0.300000', basis: 'CAP', shares: '3333333', mfnFrom: null }]);
    expect(result.founders.after).toBe('60.00');
  });

  it('at a lower pre-money the discount can beat the cap; a cap above the round price falls back to the round price', () => {
    const rows = [...founders, row('SAFE-1', 'investor', 'safe', { principal: '500000', cap: '20000000', discount: '0.20' }), row('NOTE-1', 'investor', 'note', { principal: '250000', cap: '50000000' })];
    const [low, high] = roundScenarios(rows, { amount: new D('2000000'), poolTarget: new D('0') }, [new D('6000000'), new D('12000000')]);
    expect(low?.conversions.map((entry) => entry.basis)).toEqual(['DISCOUNT', 'ROUND_PRICE']);
    expect(high?.conversions.map((entry) => entry.basis)).toEqual(['DISCOUNT', 'ROUND_PRICE']);
    expect(Number(low?.founders.after)).toBeLessThan(Number(high?.founders.after));
    expect(low?.notes).toContain('SAFEs and notes convert at the lower of the cap price and the discounted round price; note interest is not modelled.');
  });

  it('an MFN SAFE takes the better cap of a SAFE issued after it', () => {
    const rows = [
      ...founders,
      row('SAFE-1', 'investor', 'safe', { principal: '250000', cap: '8000000', mfn: true, issuedOn: '2025-01-10' }),
      row('SAFE-2', 'investor', 'safe', { principal: '250000', cap: '6000000', issuedOn: '2025-06-01' }),
    ];
    expect(effectiveTerms(rows).map((entry) => [entry.row.securityId, entry.cap?.toString(), entry.mfnFrom])).toEqual([
      ['SAFE-1', '6000000', 'SAFE-2'],
      ['SAFE-2', '6000000', null],
    ]);
    const result = roundScenario(rows, round('12000000', '3000000'));
    expect(result.conversions[0]).toMatchObject({ basis: 'CAP', mfnFrom: 'SAFE-2', shares: result.conversions[1]?.shares });
  });

  it('refuses rounds it cannot price', () => {
    expect(() => roundScenario([], round('1', '1'))).toThrow(RoundModelError);
    expect(() => roundScenario(founders, round('0', '1'))).toThrow(RoundModelError);
    expect(() => roundScenario(founders, round('1', '1', '1'))).toThrow(RoundModelError);
    expect(() => roundScenario([...founders, row('SAFE-1', 'investor', 'safe', { principal: '9000000', cap: '1000000' })], round('5000000', '1000000'))).toThrow(/more than the whole company/);
  });

  it('describes liquidation preferences against the 1x non-participating baseline', () => {
    expect(liquidationPreference(new D(1), false).standard).toBe(true);
    expect(liquidationPreference(new D(2), true)).toMatchObject({ standard: false, statement: expect.stringMatching(/^2x participating: on a sale the investor first takes 2× its money and then also shares/) });
  });
});
