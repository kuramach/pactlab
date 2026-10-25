import { describe, expect, it } from 'vitest';
import { projectValue, type ProjectionTrend } from './projection';

const trend = (overrides: Partial<ProjectionTrend>): ProjectionTrend => ({
  key: 'macro.rates',
  label: 'Inflation and interest rates',
  direction: 'UP',
  magnitude: 'MEDIUM',
  confidence: 'MEDIUM',
  provenance: 'AI',
  effects: [{ lever: 'DISCOUNT_RATE', whenUp: 1 }],
  weight: '1',
  ...overrides,
});
const base = { startValue: '10000000', currency: 'USD', baseGrowth: '0.10', baseMargin: '0.20' };

describe('Foresight projection (T-073)', () => {
  it('with no trends, compounds base growth: a path, not a point', () => {
    const result = projectValue({ ...base, trends: [] });
    expect(result.path.map((year) => year.base)).toEqual(['10000000', '11000000', '12100000', '13300000', '14600000', '16100000']);
    expect(result.path[5]).toMatchObject({ low: '16100000', high: '16100000' });
    expect(result.impacts).toEqual([]);
  });

  it('turns each trend into named, inspectable impacts and a range that widens with low confidence', () => {
    const rates = trend({});
    const demand = trend({ key: 'saas.it_spend', label: 'Enterprise software spend', effects: [{ lever: 'GROWTH', whenUp: 1 }], magnitude: 'HIGH', confidence: 'LOW', provenance: 'USER' });
    const result = projectValue({ ...base, trends: [rates, demand] });
    expect(result.impacts).toEqual([
      expect.objectContaining({ trendKey: 'macro.rates', lever: 'DISCOUNT_RATE', change: '0.005', explanation: expect.stringContaining('exit multiple −5%') }),
      expect.objectContaining({ trendKey: 'saas.it_spend', lever: 'GROWTH', change: '0.03', provenance: 'USER' }),
    ]);
    const year5 = result.path[5];
    expect(Number(year5?.low)).toBeLessThan(Number(year5?.base));
    expect(Number(year5?.high)).toBeGreaterThan(Number(year5?.base));
    // Growth +3 points compounds; the rate rise trims the exit multiple 5%.
    expect(year5?.base).toBe(String(Math.round(10000000 * 1.13 ** 5 * 0.95 / 1e5) * 1e5));
    expect(result.sensitivity.map((entry) => entry.trendKey)).toEqual(['saas.it_spend', 'macro.rates']);
  });

  it('a flat or zero-weight trend changes nothing; DOWN is the opposite of UP', () => {
    const none = projectValue({ ...base, trends: [] }).path[5]?.base;
    expect(projectValue({ ...base, trends: [trend({ direction: 'FLAT' })] }).path[5]?.base).toBe(none);
    expect(projectValue({ ...base, trends: [trend({ weight: '0' })] }).path[5]?.base).toBe(none);
    const up = Number(projectValue({ ...base, trends: [trend({})] }).path[5]?.base);
    const down = Number(projectValue({ ...base, trends: [trend({ direction: 'DOWN' })] }).path[5]?.base);
    expect(up).toBeLessThan(Number(none));
    expect(down).toBeGreaterThan(Number(none));
  });

  it('refuses a non-positive starting value', () => {
    expect(() => projectValue({ ...base, startValue: '0', trends: [] })).toThrow(RangeError);
  });
});
