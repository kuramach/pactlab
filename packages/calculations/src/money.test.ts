import { describe, expect, it } from 'vitest';
import { Money, MoneyError } from './money';

describe('Money', () => {
  it('adds exactly where floating point would drift', () => {
    expect(Money.of('0.1', 'USD').add(Money.of('0.2', 'USD')).toDecimalString()).toBe('0.3');
  });

  it('rejects floating-point number inputs', () => {
    expect(() => Money.of(0.1 as unknown as string, 'USD')).toThrow(MoneyError);
    expect(() => Money.of('1e3', 'USD')).toThrow(MoneyError);
  });

  it('refuses implicit currency conversion', () => {
    expect(() => Money.of('1', 'USD').add(Money.of('1', 'EUR'))).toThrow(/Currency mismatch/);
  });

  it('rounds to currency scale with banker rounding', () => {
    expect(Money.of('2.345', 'USD').toFixed()).toBe('2.34');
    expect(Money.of('2.355', 'USD').toFixed()).toBe('2.36');
    expect(Money.of('1234.5', 'JPY').toFixed()).toBe('1234');
    expect(Money.of('1.2345', 'KWD').toFixed()).toBe('1.234');
  });

  it('multiplies by decimal factors', () => {
    expect(Money.of('12500000.00', 'USD').multiply('6.5').toFixed()).toBe('81250000.00');
  });

  it('allocates without losing a minor unit', () => {
    const parts = Money.of('100.00', 'USD').allocate(['1', '1', '1']);
    expect(parts.map((part) => part.toFixed())).toEqual(['33.34', '33.33', '33.33']);
    const total = parts.reduce((sum, part) => sum.add(part), Money.zero('USD'));
    expect(total.toFixed()).toBe('100.00');
  });

  it('allocates negative amounts symmetrically', () => {
    const parts = Money.of('-0.05', 'USD').allocate(['1', '1']);
    expect(parts.map((part) => part.toFixed())).toEqual(['-0.03', '-0.02']);
  });

  it('rejects invalid allocation ratios', () => {
    expect(() => Money.of('1', 'USD').allocate([])).toThrow(MoneyError);
    expect(() => Money.of('1', 'USD').allocate(['0', '0'])).toThrow(MoneyError);
    expect(() => Money.of('1', 'USD').allocate(['-1', '2'])).toThrow(MoneyError);
  });

  it('serializes as fixed-scale strings', () => {
    expect(JSON.stringify(Money.of('5', 'EUR'))).toBe('{"amount":"5.00","currency":"EUR"}');
  });
});
