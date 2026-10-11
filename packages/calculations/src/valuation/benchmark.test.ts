import { describe, expect, it } from 'vitest';
import { arrGrowthFrom, askingImpliedMultiple, benchmarkMultiple, comparableSetHash, riskAdjustedEnterpriseValue, runValuation, type ComparableInput } from '.';

const comp = (id: string, ev: string, arr: string, extra: Partial<ComparableInput> = {}): ComparableInput => ({
  id,
  name: `Synthetic ${id}`,
  kind: 'PRECEDENT_TRANSACTION',
  origin: 'SYNTHETIC',
  enterpriseValue: ev,
  arr,
  arrGrowth: null,
  nrr: null,
  grr: null,
  ...extra,
});

// Multiples 2, 3, 4, 5, 6 (EV ÷ ARR).
const FIVE = [
  comp('a', '2000000', '1000000', { arrGrowth: '0.10', nrr: '0.95', grr: '0.85', origin: 'ENTERED' }),
  comp('b', '6000000', '2000000', { arrGrowth: '0.20', nrr: '1.00', grr: '0.88' }),
  comp('c', '4000000', '1000000', { arrGrowth: '0.30', nrr: '1.05', grr: '0.90' }),
  comp('d', '10000000', '2000000', { arrGrowth: '0.40', nrr: '1.10', grr: '0.92', origin: 'OWN_DEAL', kind: 'OWN_DEAL' }),
  comp('e', '3000000', '500000'),
];

describe('benchmarkMultiple', () => {
  it('reports quartiles by linear interpolation, ordered comparables and origin counts', () => {
    const benchmark = benchmarkMultiple({ comparables: FIVE, target: { arrGrowth: null, nrr: null, grr: null }, chosenMultiple: null, askingImpliedMultiple: null });
    expect(benchmark.stats).toEqual({ min: '2.00', p25: '3.00', median: '4.00', p75: '5.00', max: '6.00' });
    expect(benchmark.comparables.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(benchmark).toMatchObject({ count: 5, syntheticCount: 3, sufficient: true, byOrigin: { SYNTHETIC: 3, ENTERED: 1, OWN_DEAL: 1, PROVIDER: 0 } });
  });

  it('interpolates between ranks on even-sized sets', () => {
    const benchmark = benchmarkMultiple({ comparables: FIVE.slice(0, 4), target: { arrGrowth: null, nrr: null, grr: null }, chosenMultiple: null, askingImpliedMultiple: null });
    expect(benchmark.stats).toMatchObject({ p25: '2.75', median: '3.50', p75: '4.25' });
  });

  it('places the chosen and asking multiples with percentiles and positions', () => {
    const benchmark = benchmarkMultiple({ comparables: FIVE, target: { arrGrowth: null, nrr: null, grr: null }, chosenMultiple: '4', askingImpliedMultiple: '5.5' });
    expect(benchmark.chosen).toEqual({ multiple: '4.00', percentile: 50, position: 'MID' });
    expect(benchmark.asking).toEqual({ multiple: '5.50', percentile: 80, position: 'HIGH' });
    const place = (m: string) => benchmarkMultiple({ comparables: FIVE, target: { arrGrowth: null, nrr: null, grr: null }, chosenMultiple: m, askingImpliedMultiple: null }).chosen;
    expect(place('1.5')).toMatchObject({ position: 'BELOW_RANGE', percentile: 0 });
    expect(place('2.5')).toMatchObject({ position: 'LOW', percentile: 20 });
    expect(place('6')).toMatchObject({ position: 'HIGH', percentile: 90 });
    expect(place('7')).toMatchObject({ position: 'ABOVE_RANGE', percentile: 100 });
  });

  it('compares drivers with the medians of comparables that report them', () => {
    const benchmark = benchmarkMultiple({ comparables: FIVE, target: { arrGrowth: '0.12', nrr: '1.04', grr: null }, chosenMultiple: null, askingImpliedMultiple: null });
    expect(benchmark.drivers).toEqual([
      { key: 'ARR_GROWTH', target: '0.1200', median: '0.2500', reportedBy: 4, comparison: 'WEAKER' },
      { key: 'NRR', target: '1.0400', median: '1.0250', reportedBy: 4, comparison: 'SIMILAR' },
      { key: 'GRR', target: null, median: '0.8900', reportedBy: 4, comparison: null },
    ]);
  });

  it('flags a thin set, handles an empty one and hashes the set independent of order', () => {
    const thin = benchmarkMultiple({ comparables: FIVE.slice(0, 2), target: { arrGrowth: null, nrr: null, grr: null }, chosenMultiple: '4', askingImpliedMultiple: null });
    expect(thin.sufficient).toBe(false);
    const empty = benchmarkMultiple({ comparables: [], target: { arrGrowth: '0.1', nrr: null, grr: null }, chosenMultiple: '4', askingImpliedMultiple: '5' });
    expect(empty).toMatchObject({ count: 0, stats: null, chosen: null, asking: null });
    expect(comparableSetHash(['b', 'a'])).toBe(comparableSetHash(['a', 'b']));
    expect(comparableSetHash(['a'])).not.toBe(comparableSetHash(['a', 'b']));
  });

  it('refuses a comparable without positive EV and ARR', () => {
    expect(() => benchmarkMultiple({ comparables: [comp('x', '0', '100')], target: { arrGrowth: null, nrr: null, grr: null }, chosenMultiple: null, askingImpliedMultiple: null })).toThrow();
  });
});

describe('askingImpliedMultiple', () => {
  const arr = { amount: '268000.00', currency: 'USD' };
  it('divides an enterprise-value ask by ARR', () => {
    expect(askingImpliedMultiple({ asking: { amount: '1350000', currency: 'USD', basis: 'ENTERPRISE_VALUE' }, arr, bridge: null })).toBe('5.04');
  });
  it('moves an equity ask to enterprise value with the bridge items', () => {
    const bridge = { cash: '100000', debt: '50000', debtLikeItems: '30000', workingCapitalAdjustment: '-20000' };
    expect(askingImpliedMultiple({ asking: { amount: '1000000', currency: 'USD', basis: 'EQUITY_VALUE' }, arr: { amount: '250000', currency: 'USD' }, bridge })).toBe('4.00');
    expect(askingImpliedMultiple({ asking: { amount: '1000000', currency: 'USD', basis: 'EQUITY_VALUE' }, arr, bridge: null })).toBeNull();
  });
  it('does not compare across currencies', () => {
    expect(askingImpliedMultiple({ asking: { amount: '1000000', currency: 'EUR', basis: 'ENTERPRISE_VALUE' }, arr, bridge: null })).toBeNull();
  });
});

describe('arrGrowthFrom', () => {
  const point = (month: string, amount: string) => ({ month, arr: { amount, currency: 'USD' } });
  it('measures year-over-year growth and needs the year-ago month', () => {
    const series = [point('2025-06', '200000.00'), point('2026-05', '230000.00'), point('2026-06', '250000.00')];
    expect(arrGrowthFrom(series, '2026-06')).toBe('0.2500');
    expect(arrGrowthFrom(series, '2026-05')).toBeNull();
  });
});

describe('riskAdjustedEnterpriseValue', () => {
  it('applies price reductions and ignores escrows', () => {
    const result = runValuation({
      currency: 'USD',
      transactionType: 'PRIVATE_ACQUIRER',
      assumptions: { method: 'ARR_MULTIPLE', arr: '1000000', multiple: '5' },
      bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' },
      stockConsiderationShare: '0',
      adjustments: [
        { findingId: '0190f000-0000-7000-8000-00000000000a', findingVersion: 1, type: 'PRICE_REDUCTION', currency: 'USD', low: '200000', high: '200000', point: 'MID', basis: 'Synthetic' },
        { findingId: '0190f000-0000-7000-8000-00000000000b', findingVersion: 1, type: 'ESCROW', currency: 'USD', low: '300000', high: '300000', point: 'MID', basis: 'Synthetic' },
      ],
      lbo: null,
      accretionDilution: null,
      sensitivity: null,
    });
    expect(riskAdjustedEnterpriseValue(result)).toEqual({ amount: '4800000.00', currency: 'USD' });
  });
});
