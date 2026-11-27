import { describe, expect, it } from 'vitest';
import { pnlPeriods } from './pnl';
import { fiscalYears, pnlLineCurrencies, pnlLinesFromRecords, pnlTrend } from './trend';

const line = (id: string, account: string, period: string, amount: string, kind: string) => ({ id, canonical: { account, month: period, amount, line_kind: kind } });
const FRAUD = [{ key: 'fraud', label: 'Fraud losses', pattern: /fraud/i }];

describe('the multi-year P&L trend (pnl-trend-1)', () => {
  it('reads every stated year, with growth, margins and the key ratio, each naming its rows', () => {
    const records = [
      line('a1', 'Revenue', '2023', '1000.00', 'REVENUE'),
      line('a2', 'Cost of processing', '2023', '400.00', 'COGS'),
      line('a3', 'Fraud losses', '2023', '10.00', 'OPEX'),
      line('b1', 'Revenue', '2024', '1200.00', 'REVENUE'),
      line('b2', 'Cost of processing', '2024', '480.00', 'COGS'),
      line('b3', 'Fraud losses', '2024', '-24.00', 'OPEX'),
    ];
    const trend = pnlTrend(pnlPeriods(pnlLinesFromRecords(records)), FRAUD);
    expect(trend.version).toBe('pnl-trend-1');
    expect(trend.years.map((year) => year.year)).toEqual(['2023', '2024']);
    expect(trend.years[0]).toMatchObject({ basis: 'STATED', revenue: '1000.00', grossMargin: '0.6000', operatingMargin: '0.5900', revenueGrowth: null });
    expect(trend.years[1]).toMatchObject({ revenueGrowth: '0.2000', ratios: [{ key: 'fraud', amount: '24.00', ratio: '0.0200', evidenceIds: ['b3'] }] });
    expect(trend.years[1]?.evidenceIds).toEqual(expect.arrayContaining(['b1', 'b2', 'b3']));
  });

  it('rolls twelve months into a year, leaves a partial year out, and never scales it up', () => {
    const months = Array.from({ length: 12 }, (_, index) => line(`m${index}`, 'Revenue', `2025-${String(index + 1).padStart(2, '0')}`, '100.00', 'REVENUE'));
    const partial = [line('p1', 'Revenue', '2026-01', '100.00', 'REVENUE')];
    const { years, partial: left } = fiscalYears(pnlPeriods(pnlLinesFromRecords([...months, ...partial])));
    expect(years.map((year) => [year.period, year.revenue])).toEqual([['2025', '1200.00']]);
    expect(left).toEqual(['2026']);
  });

  it('reads the newer row when two imports hold the same line, so a re-sent statement never doubles a year', () => {
    const lines = pnlLinesFromRecords([line('0190-a', 'Revenue', '2025', '100.00', 'REVENUE'), line('0190-b', 'Revenue', '2025', '110.00', 'REVENUE'), line('0190-c', 'Unclassified', '2025', '5.00', '')]);
    expect(lines).toEqual([{ evidenceId: '0190-b', account: 'Revenue', period: '2025', amount: '110.00', kind: 'REVENUE' }]);
  });

  it('compares like with like: no growth across a currency change, and a mixed year is left out (T-170)', () => {
    const declared = (id: string, account: string, period: string, amount: string, kind: string, currency: string) => ({ id, canonical: { account, month: period, amount, line_kind: kind, currency } });
    const records = [
      declared('a1', 'Revenue', '2023', '1000', 'REVENUE', 'JPY'),
      declared('b1', 'Revenue', '2024', '1100', 'REVENUE', 'JPY'),
      declared('c1', 'Revenue', '2025', '9.00', 'REVENUE', 'USD'),
      declared('d1', 'Revenue', '2026', '5.00', 'REVENUE', 'USD'),
      declared('d2', 'Other revenue', '2026', '500', 'REVENUE', 'JPY'),
      line('e1', 'Revenue', '2027', '12.00', 'REVENUE'),
    ];
    const trend = pnlTrend(pnlPeriods(pnlLinesFromRecords(records)), FRAUD, pnlLineCurrencies(records));
    expect(trend.years.map((year) => [year.year, year.currency, year.revenueGrowth])).toEqual([
      ['2023', 'JPY', null],
      ['2024', 'JPY', '0.1000'],
      ['2025', 'USD', null],
      ['2027', null, null],
    ]);
    expect(trend.currencyBreaks).toEqual([{ year: '2025', from: 'JPY', to: 'USD' }]);
    expect(trend.mixedCurrencyYears).toEqual(['2026']);
  });

  it('reads undeclared lines as the pact’s own, as before', () => {
    const records = [line('a1', 'Revenue', '2024', '100.00', 'REVENUE'), line('b1', 'Revenue', '2025', '150.00', 'REVENUE')];
    const trend = pnlTrend(pnlPeriods(pnlLinesFromRecords(records)), FRAUD, pnlLineCurrencies(records));
    expect(trend.years[1]).toMatchObject({ currency: null, revenueGrowth: '0.5000' });
    expect(trend.currencyBreaks).toEqual([]);
  });
});
