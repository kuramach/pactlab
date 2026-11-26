import { describe, expect, it } from 'vitest';
import { percentOf } from './format';

describe('percentOf', () => {
  it('rounds a decimal fraction to a percentage on the digits', () => {
    expect(percentOf('0.009412', 2)).toBe('0.94%');
    expect(percentOf('0.0089996', 2)).toBe('0.90%');
    expect(percentOf('0.3200', 1)).toBe('32.0%');
    expect(percentOf('1.5', 0)).toBe('150%');
    expect(percentOf('-0.0125', 1)).toBe('−1.3%');
    expect(percentOf(null, 2)).toBe('—');
  });
});
