import { describe, expect, it } from 'vitest';
import { comparePnlFigure, pnlForPeriod, pnlPeriods, trailingPnl, type PnlLineInput } from './pnl';

let next = 0;
const line = (period: string, kind: PnlLineInput['kind'], amount: string, account = kind.toLowerCase()): PnlLineInput => ({ evidenceId: `e-${String(next++).padStart(4, '0')}`, account, period, amount, kind });
const month = (period: string, revenue = '1000', cogs = '-300', opex = '-200') => [line(period, 'REVENUE', revenue), line(period, 'COGS', cogs), line(period, 'OPEX', opex), line(period, 'OTHER_EXPENSE', '50')];
const year = (y: number) => Array.from({ length: 12 }, (_, index) => month(`${y}-${String(index + 1).padStart(2, '0')}`)).flat();

describe('pnlPeriods', () => {
  it('adds the lines of each period, reading costs as costs whichever sign the file used', () => {
    const [period] = pnlPeriods([...month('2025-01'), line('2025-01', 'COGS', '-0.10', 'freight')]);
    expect(period).toMatchObject({ period: '2025-01', granularity: 'MONTH', revenue: '1000.00', costOfRevenue: '300.10', operatingExpenses: '200.00', ebitda: '499.90', netIncome: '449.90' });
    expect(period?.sources).toHaveLength(5);
  });

  it('keeps decimals exact (no floating point)', () => {
    const [period] = pnlPeriods([line('2025-01', 'REVENUE', '0.1'), line('2025-01', 'REVENUE', '0.2')]);
    expect(period?.revenue).toBe('0.30');
  });

  it('refuses a line whose amount is not a decimal', () => {
    expect(() => pnlPeriods([line('2025-01', 'REVENUE', '1e3')])).toThrow();
  });

  it('orders periods and marks their granularity', () => {
    expect(pnlPeriods([...month('2025-02'), ...month('2024'), ...month('Q1 25')]).map((period) => [period.period, period.granularity])).toEqual([
      ['2024', 'YEAR'],
      ['2025-02', 'MONTH'],
      ['Q1 25', 'OTHER'],
    ]);
  });
});

describe('pnlForPeriod', () => {
  it('matches a written period, with or without FY', () => {
    const periods = pnlPeriods([...month('2024')]);
    expect(pnlForPeriod(periods, 'FY2024')?.period).toBe('2024');
    expect(pnlForPeriod(periods, 'fy 2024')?.period).toBe('2024');
    expect(pnlForPeriod(periods, '2023')).toBeNull();
  });

  it('rolls a year up from all twelve months, citing every row, and never from fewer', () => {
    const periods = pnlPeriods(year(2025));
    const rolled = pnlForPeriod(periods, 'FY2025');
    expect(rolled).toMatchObject({ period: '2025', granularity: 'YEAR', revenue: '12000.00', ebitda: '6000.00' });
    expect(rolled?.rolledUpFrom).toHaveLength(12);
    expect(rolled?.sources).toHaveLength(48);
    expect(pnlForPeriod(periods.slice(1), '2025')).toBeNull();
  });
});

describe('trailingPnl', () => {
  it('sums the twelve months to the latest imported month', () => {
    const result = trailingPnl(pnlPeriods([...year(2024), ...month('2025-01', '2000')]));
    expect(result).toMatchObject({ basis: 'TTM', from: '2024-02', to: '2025-01', revenue: '13000.00', ebitda: '7000.00', lineCount: 48 });
  });

  it('falls back to the latest stated year when the months are incomplete, and says why when there is neither', () => {
    expect(trailingPnl(pnlPeriods([...month('2024'), ...month('2025-01')]))).toMatchObject({ basis: 'FISCAL_YEAR', from: '2024', revenue: '1000.00' });
    const unavailable = trailingPnl(pnlPeriods(month('2025-03')));
    expect('unavailable' in unavailable && unavailable.unavailable).toMatch(/11 missing/);
    expect(trailingPnl([])).toHaveProperty('unavailable');
  });
});

describe('comparePnlFigure', () => {
  it('treats rounding within one unit as agreement and states the difference', () => {
    expect(comparePnlFigure('6000.40', '6000')).toEqual({ agrees: true, difference: '0.40' });
    expect(comparePnlFigure('6000', '6500')).toEqual({ agrees: false, difference: '-500.00' });
  });
});
