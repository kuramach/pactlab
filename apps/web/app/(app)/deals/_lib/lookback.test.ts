import { describe, expect, it } from 'vitest';
import { describeLookback, readLookback } from './lookback';

describe('lookback (T-169)', () => {
  it('reads only the offered choices', () => {
    expect(readLookback('24')).toBe(24);
    expect(readLookback('ALL')).toBe('ALL');
    for (const bad of ['0', '7', 'forever', '', null]) expect(readLookback(bad), String(bad)).toBeNull();
  });

  it('says the window in words, 24 months when unset', () => {
    expect(describeLookback(undefined)).toBe('last 24 months');
    expect(describeLookback(null)).toBe('last 24 months');
    expect(describeLookback(60)).toBe('last 60 months');
    expect(describeLookback('ALL')).toBe('all history');
  });
});
