import { describe, expect, it } from 'vitest';
import { fractionToPercent, percentToFraction } from './format';

describe('Foresight percent fields', () => {
  it('turns typed percents into exact fractions', () => {
    expect(percentToFraction('12')).toBe('0.12');
    expect(percentToFraction('7.5')).toBe('0.075');
    expect(percentToFraction('100')).toBe('1');
    expect(percentToFraction('0.25')).toBe('0.0025');
    expect(percentToFraction('-5')).toBe('-0.05');
    expect(percentToFraction('0')).toBe('0');
    expect(percentToFraction('12%')).toBeNull();
  });

  it('shows stored fractions as percents', () => {
    expect(fractionToPercent('0.12')).toBe('12');
    expect(fractionToPercent('0.075')).toBe('7.5');
    expect(fractionToPercent('0.100000')).toBe('10');
    expect(fractionToPercent('-0.05')).toBe('-5');
  });
});
