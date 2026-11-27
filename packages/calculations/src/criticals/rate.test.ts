import { describe, expect, it } from 'vitest';
import { capRate, rateCritical, type CriticalFigure } from './rate';

const occupancy = { comparator: 'AT_LEAST', threshold: '0.90', lookbackYears: 3, evenBand: null } as const;
const year = (period: string, value: string | null): CriticalFigure => ({ period, value, source: 'CALCULATED' });

describe('rating a critical (criticals-1)', () => {
  it('a trend critical over three imported years: Good when every year clears, Bad when one misses beyond the band', () => {
    expect(rateCritical(occupancy, [year('FY2024', '0.9314'), year('FY2025', '0.9115'), year('FY2026', '0.9050')]).rating).toBe('GOOD');
    const bad = rateCritical(occupancy, [year('FY2024', '0.9314'), year('FY2025', '0.9115'), year('FY2026', '0.8854')]);
    expect(bad.rating).toBe('BAD');
    expect(bad.figures.map((figure) => figure.outcome)).toEqual(['MET', 'MET', 'MISSED']);
    expect(bad.rationale).toContain('Missed in FY2026');
  });

  it('Even: a miss inside the band, or met only on the years the pact holds', () => {
    expect(rateCritical({ ...occupancy, evenBand: '0.02' }, [year('FY2024', '0.93'), year('FY2025', '0.91'), year('FY2026', '0.8854')]).rating).toBe('EVEN');
    const partial = rateCritical(occupancy, [year('FY2024', null), year('FY2025', '0.91'), year('FY2026', '0.92')]);
    expect(partial.rating).toBe('EVEN');
    expect(partial.rationale).toContain('Met in 2 years of the last 3');
  });

  it('No evidence is its own state, never Even', () => {
    expect(rateCritical(occupancy, [year('FY2024', null), year('FY2025', null), year('FY2026', null)]).rating).toBe('NO_EVIDENCE');
    expect(rateCritical({ comparator: 'AT_LEAST', threshold: '1.25', lookbackYears: null, evenBand: null }, []).rating).toBe('NO_EVIDENCE');
  });

  it('a single figure: met, missed, at most, and mixed across sources', () => {
    const floor = { comparator: 'AT_LEAST', threshold: '0.06', lookbackYears: null, evenBand: '0.0025' } as const;
    expect(rateCritical(floor, [year('FY2026', '0.0610')]).rating).toBe('GOOD');
    expect(rateCritical(floor, [year('FY2026', '0.0580')]).rating).toBe('EVEN');
    expect(rateCritical(floor, [year('FY2026', '0.0473')]).rating).toBe('BAD');
    expect(rateCritical({ ...floor, comparator: 'AT_MOST', evenBand: null }, [year('FY2026', '0.0473')]).rating).toBe('GOOD');
    expect(rateCritical(floor, [year('FY2026', '0.0610'), { period: null, value: '0.0450', source: 'DOCUMENT' }]).rating).toBe('EVEN');
  });

  it('cap rate is NOI over price, in decimals; nothing without both', () => {
    expect(capRate('993010.37', '21000000')).toBe('0.0473');
    expect(capRate(null, '21000000')).toBeNull();
    expect(capRate('993010.37', '0')).toBeNull();
  });
});
