import { describe, expect, it } from 'vitest';
import {
  currencyMinorUnits,
  excessMinorDigits,
  formatAmount,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyRange,
  formatMonth,
  formatNumber,
  LAUNCH_CURRENCIES,
  LAUNCH_LOCALES,
} from '.';

// Intl's own spaces: no-break (U+00A0) is normalised to a plain space; the narrow one (U+202F, fr-FR grouping) is kept.
const NNBSP = ' ';

describe('ISO 4217 minor units', () => {
  it('knows the launch set, and JPY has none', () => {
    expect(LAUNCH_CURRENCIES.map((code) => [code, currencyMinorUnits(code)])).toEqual([
      ['USD', 2],
      ['GBP', 2],
      ['EUR', 2],
      ['JPY', 0],
      ['INR', 2],
    ]);
    expect(currencyMinorUnits('KWD')).toBe(3);
    expect(currencyMinorUnits('jpy')).toBe(0);
    expect(currencyMinorUnits('CHF')).toBe(2);
  });

  it('counts decimals beyond the minor unit', () => {
    expect(excessMinorDigits('1000', 'JPY')).toBe(0);
    expect(excessMinorDigits('1000.00', 'JPY')).toBe(0);
    expect(excessMinorDigits('1000.5', 'JPY')).toBe(1);
    expect(excessMinorDigits('10.125', 'EUR')).toBe(1);
    expect(excessMinorDigits('10.120', 'EUR')).toBe(0);
  });
});

describe('formatMoney: launch currencies in launch locales', () => {
  const amount = '1234567.5';
  const cases: Record<(typeof LAUNCH_LOCALES)[number], Record<(typeof LAUNCH_CURRENCIES)[number], string>> = {
    'en-US': { USD: 'USD 1,234,567.5', GBP: 'GBP 1,234,567.5', EUR: 'EUR 1,234,567.5', JPY: 'JPY 1,234,568', INR: 'INR 1,234,567.5' },
    'en-GB': { USD: 'USD 1,234,567.5', GBP: 'GBP 1,234,567.5', EUR: 'EUR 1,234,567.5', JPY: 'JPY 1,234,568', INR: 'INR 1,234,567.5' },
    'de-DE': { USD: '1.234.567,5 USD', GBP: '1.234.567,5 GBP', EUR: '1.234.567,5 EUR', JPY: '1.234.568 JPY', INR: '1.234.567,5 INR' },
    'fr-FR': { USD: `1${NNBSP}234${NNBSP}567,5 USD`, GBP: `1${NNBSP}234${NNBSP}567,5 GBP`, EUR: `1${NNBSP}234${NNBSP}567,5 EUR`, JPY: `1${NNBSP}234${NNBSP}568 JPY`, INR: `1${NNBSP}234${NNBSP}567,5 INR` },
    'ja-JP': { USD: 'USD 1,234,567.5', GBP: 'GBP 1,234,567.5', EUR: 'EUR 1,234,567.5', JPY: 'JPY 1,234,568', INR: 'INR 1,234,567.5' },
    'en-IN': { USD: 'USD 12,34,567.5', GBP: 'GBP 12,34,567.5', EUR: 'EUR 12,34,567.5', JPY: 'JPY 12,34,568', INR: 'INR 12,34,567.5' },
  };
  for (const [locale, byCurrency] of Object.entries(cases)) {
    for (const [currency, expected] of Object.entries(byCurrency)) {
      it(`${currency} in ${locale}`, () => {
        expect(formatMoney({ amount, currency }, { locale })).toBe(expected);
      });
    }
  }

  it('rounds yen to whole units, half to even, like storage', () => {
    expect(formatAmount('1234567.5', 'JPY')).toBe('JPY 1,234,568');
    expect(formatAmount('1234566.5', 'JPY')).toBe('JPY 1,234,566');
    expect(formatAmount('1000.00', 'JPY', { fraction: 'minor' })).toBe('JPY 1,000');
    expect(formatAmount('2.125', 'USD')).toBe('USD 2.12');
  });

  it('groups rupees in lakh and crore from Intl', () => {
    expect(formatAmount('123456789.55', 'INR')).toBe('INR 12,34,56,789.55');
    expect(formatAmount('10000000', 'INR')).toBe('INR 1,00,00,000');
    expect(formatAmount('123456789.55', 'INR', { display: 'symbol' })).toBe('₹12,34,56,789.55');
  });

  it('keeps an amount’s own decimals up to the minor unit, or pads them on request', () => {
    expect(formatAmount('52000000', 'USD')).toBe('USD 52,000,000');
    expect(formatAmount('1450000.00', 'USD')).toBe('USD 1,450,000.00');
    expect(formatAmount('1450000', 'GBP', { fraction: 'minor' })).toBe('GBP 1,450,000.00');
    expect(formatAmount('1450000.75', 'EUR', { fraction: 'none' })).toBe('EUR 1,450,001');
    expect(formatAmount('40000000.00', 'USD', { fraction: 'trim' })).toBe('USD 40,000,000');
    expect(formatAmount('40000000.50', 'USD', { fraction: 'trim' })).toBe('USD 40,000,000.5');
  });

  it('never shows a bare dollar sign for another currency', () => {
    for (const currency of ['GBP', 'EUR', 'JPY', 'INR']) {
      for (const locale of LAUNCH_LOCALES) {
        expect(formatAmount('1000', currency, { locale })).not.toContain('$');
        expect(formatAmount('1000', currency, { locale, display: 'symbol' })).not.toMatch(/(^|[^A-Z])\$/);
      }
    }
    expect(formatAmount('1000', 'USD', { display: 'symbol' })).toBe('$1,000');
    expect(formatAmount('1000', 'EUR', { display: 'symbol', locale: 'de-DE' })).toBe('1.000 €');
    expect(formatAmount('1000', 'GBP', { display: 'symbol', locale: 'en-GB' })).toBe('£1,000');
  });

  it('is exact on amounts no float can hold', () => {
    expect(formatAmount('90071992547409931.01', 'USD')).toBe('USD 90,071,992,547,409,931.01');
  });

  it('shows negatives, nothing and the unparseable plainly', () => {
    expect(formatAmount('-1273881.29', 'USD')).toBe('-USD 1,273,881.29');
    expect(formatMoney(null)).toBe('—');
    expect(formatAmount('n/a', 'EUR')).toBe('EUR n/a');
  });

  it('formats compact figures for charts', () => {
    expect(formatAmount('1250000', 'USD', { compact: true })).toBe('USD 1.25M');
    expect(formatAmount('1250000', 'JPY', { compact: true })).toBe('JPY 1M');
  });

  it('formats a range in one currency', () => {
    expect(formatMoneyRange('1000000', '3000000', 'EUR')).toBe('EUR 1,000,000 – 3,000,000');
    expect(formatMoneyRange('500000', '500000', 'JPY')).toBe('JPY 500,000');
    expect(formatMoneyRange('1000000', '30000000', 'INR')).toBe('INR 10,00,000 – 3,00,00,000');
  });
});

describe('numbers and dates', () => {
  it('groups numbers for the locale', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber('1234567.891')).toBe('1,234,567.891');
    expect(formatNumber('1234567', { locale: 'en-IN' })).toBe('12,34,567');
    expect(formatNumber('1234.5', { locale: 'de-DE' })).toBe('1.234,5');
  });

  it('formats dates in UTC', () => {
    expect(formatDate('2026-11-26T23:30:00Z')).toBe('Nov 26, 2026');
    expect(formatDate('2026-11-26T23:30:00Z', { locale: 'en-GB' })).toBe('26 Nov 2026');
    expect(formatDate('2026-11-26T23:30:00Z', { locale: 'ja-JP' })).toBe('2026/11/26');
    expect(formatDateTime('2026-11-26T23:30:00Z', { locale: 'en-GB' })).toBe('26 Nov 2026, 23:30');
    expect(formatMonth('2026-09')).toBe('Sep 2026');
    expect(formatMonth('2026-09', { style: 'long' })).toBe('September 2026');
    expect(formatMonth('2026-09', { style: '2-digit' })).toBe('Sep 26');
    expect(formatDate('nope')).toBe('nope');
  });
});
