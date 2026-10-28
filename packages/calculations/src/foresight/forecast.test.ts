import { describe, expect, it } from 'vitest';
import { projectWithForecasts } from './forecast';

const inflation = (values: string[]) => ({ key: 'inflation', label: 'Inflation', neutral: '2', growthPerPoint: '0.5', discountPerPoint: '0.75', values });
const gdp = (values: string[]) => ({ key: 'gdp_growth', label: 'Real GDP growth', neutral: '2', growthPerPoint: '0.75', discountPerPoint: '0', values });

describe('value under numeric forecasts (T-094 B10)', () => {
  it('at neutral levels the path is plain compounding at base growth', () => {
    const result = projectWithForecasts({ startValue: '10000000', currency: 'USD', baseGrowth: '0.10', metrics: [inflation(['2', '2', '2', '2', '2']), gdp(['2', '2', '2', '2', '2'])] });
    expect(result.path.map((p) => p.value)).toEqual(['10000000', '11000000', '12100000', '13300000', '14600000', '16100000']);
    expect(result.drivers.every((d) => d.year5Change === '0')).toBe(true);
  });

  it('higher inflation lifts nominal growth but cuts the multiple: net lower value', () => {
    const neutral = projectWithForecasts({ startValue: '10000000', currency: 'USD', baseGrowth: '0.10', metrics: [inflation(['2', '2', '2', '2', '2'])] });
    const hot = projectWithForecasts({ startValue: '10000000', currency: 'USD', baseGrowth: '0.10', metrics: [inflation(['4', '4', '4', '4', '4'])] });
    // Growth +1 point a year; discount rate +1.5 points → multiple −15 %.
    expect(hot.path[1]?.growth).toBe('0.11');
    expect(hot.path[1]?.multipleFactor).toBe('0.85');
    expect(Number(hot.path[5]?.value)).toBeLessThan(Number(neutral.path[5]?.value));
    expect(hot.drivers[0]).toMatchObject({ key: 'inflation' });
    expect(Number(hot.drivers[0]?.year5Change)).toBeLessThan(0);
  });

  it('is deterministic and refuses a non-positive start', () => {
    const input = { startValue: '5000000', currency: 'EUR', baseGrowth: '0.08', metrics: [gdp(['1.1', '1.2', '1.3', '1.2', '1.1'])] };
    expect(projectWithForecasts(input)).toEqual(projectWithForecasts(input));
    expect(() => projectWithForecasts({ ...input, startValue: '0' })).toThrow(RangeError);
  });
});
