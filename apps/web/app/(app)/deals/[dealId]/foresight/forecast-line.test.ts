import { describe, expect, it } from 'vitest';
import { chartRange, clamp, formatValue, snap, valueAt, yOf } from './forecast-line';

describe('forecast line editor (batch 1)', () => {
  it('snaps drags to 0.1 points and keeps values in the allowed band', () => {
    expect(snap(2.449)).toBe(2.4);
    expect(snap(-1.06)).toBe(-1.1);
    expect(clamp(150)).toBe(100);
    expect(clamp(-80)).toBe(-50);
    expect(formatValue(3)).toBe('3');
    expect(formatValue(2.45)).toBe('2.5');
  });

  it('fits every line and the neutral level, with room to drag', () => {
    expect(chartRange([[2, 2.4, 3], [1.8, 1.9]], 2)).toEqual({ min: -1, max: 5 });
    expect(chartRange([[6, 6, 6]], 6)).toEqual({ min: 4, max: 8 });
  });

  it('maps positions to values and back', () => {
    const range = { min: 0, max: 10 };
    expect(valueAt(0, 200, range)).toBe(10);
    expect(valueAt(200, 200, range)).toBe(0);
    expect(valueAt(100, 200, range)).toBe(5);
    expect(valueAt(-30, 200, range)).toBe(10);
    expect(yOf(5, 200, range)).toBe(100);
    expect(valueAt(yOf(3.7, 200, range), 200, range)).toBe(3.7);
  });
});
