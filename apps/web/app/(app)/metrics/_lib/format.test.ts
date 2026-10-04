import { describe, expect, it } from 'vitest';
import { formatDecimal, formatMoney, formatRatio, parseMonthParam } from './format';

describe('metrics formatting', () => {
  it('groups money without converting to floating point', () => {
    expect(formatMoney({ amount: '1450000.00', currency: 'USD' })).toBe('USD 1,450,000.00');
    expect(formatMoney({ amount: '-1273881.29', currency: 'USD' })).toBe('USD -1,273,881.29');
    expect(formatDecimal('90071992547409931.01')).toBe('90,071,992,547,409,931.01');
    expect(formatMoney(null)).toBe('—');
  });

  it('shifts ratios to percentages as strings', () => {
    expect(formatRatio('1.1201')).toBe('112.01%');
    expect(formatRatio('0.0083')).toBe('0.83%');
    expect(formatRatio('-0.8785')).toBe('-87.85%');
    expect(formatRatio('1')).toBe('100%');
    expect(formatRatio('0.5')).toBe('50%');
    expect(formatRatio('12.3456')).toBe('1,234.56%');
    expect(formatRatio(null)).toBe('—');
  });

  it('accepts only YYYY-MM months from the query string', () => {
    expect(parseMonthParam('2026-09')).toBe('2026-09');
    expect(parseMonthParam('2026-13')).toBeUndefined();
    expect(parseMonthParam(['2026-09'])).toBeUndefined();
  });
});
