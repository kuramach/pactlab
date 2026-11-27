import { describe, expect, it } from 'vitest';
import { driverTrendRule, packHistory, withHistory, type DriverSpec, type PackHistorySpec } from './history';
import type { PackRuleEvidence } from './rule-types';

const VOLUME: DriverSpec = { key: 'volume', label: 'Volume', unit: 'MONEY', evidenceType: 'test.month', mode: 'SUM', numerator: ['volume'], formula: 'Σ volume' };
const RATE: DriverSpec = { key: 'rate', label: 'Take rate', unit: 'RATIO', evidenceType: 'test.month', mode: 'RATIO', numerator: ['revenue'], denominator: ['volume'], scale: 6, formula: 'Σ revenue ÷ Σ volume' };
const CLOSING: DriverSpec = { key: 'closing', label: 'Closing count', unit: 'COUNT', evidenceType: 'test.month', mode: 'LAST', numerator: ['count'], formula: 'December count' };
const SPEC: PackHistorySpec = { drivers: [VOLUME, RATE, CLOSING], keyExpenses: [], driverImport: 'TEST_EXPORT', driverLabel: 'Test export', driverWhat: 'test export history' };

/** Twelve months a year for each year given: volume 100 a month, revenue at the year's rate, a count of 10 × month. */
function months(rates: Readonly<Record<string, string>>, options: { skip?: string } = {}): PackRuleEvidence[] {
  return Object.entries(rates).flatMap(([year, rate]) =>
    Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
      .filter((month) => month !== options.skip)
      .map((month) => ({ id: `m:${month}`, evidenceType: 'test.month', sourceRecordId: month, canonical: { month, volume: '100.00', revenue: (100 * Number(rate)).toFixed(4), count: String(10 * Number(month.slice(5))) } })),
  );
}

const pnl = (years: readonly string[]): PackRuleEvidence[] =>
  years.flatMap((year) => [
    { id: `p:${year}:r`, evidenceType: 'finance.pnl_line', sourceRecordId: `r|${year}`, canonical: { account: 'Revenue', month: year, amount: '1000.00', line_kind: 'REVENUE' } },
    { id: `p:${year}:c`, evidenceType: 'finance.pnl_line', sourceRecordId: `c|${year}`, canonical: { account: 'Costs', month: year, amount: '600.00', line_kind: 'OPEX' } },
  ]);

describe('pack history (T-184)', () => {
  it('reads each driver by calendar year (sum, ratio of sums, the last month) and lays the years side by side', () => {
    const result = packHistory(SPEC, [...months({ 2021: '0.011', 2022: '0.010', 2023: '0.009', 2024: '0.008', 2025: '0.007' }), ...pnl(['2021', '2022', '2023', '2024', '2025'])]);
    expect(result.expected).toEqual(['2021', '2022', '2023', '2024', '2025']);
    expect(result.table.years).toEqual(['FY2021', 'FY2022', 'FY2023', 'FY2024', 'FY2025']);
    expect(result.drivers.get('volume')?.map((year) => year.value)).toEqual(Array(5).fill('1200.00'));
    expect(result.drivers.get('rate')?.map((year) => year.value)).toEqual(['0.011000', '0.010000', '0.009000', '0.008000', '0.007000']);
    expect(result.drivers.get('closing')?.map((year) => year.value)).toEqual(Array(5).fill('120'));
    expect(result.table.rows.find((row) => row.key === 'revenue')?.values).toEqual(Array(5).fill('1000.00'));
    expect(result.table.rows.find((row) => row.key === 'operating_margin')?.values).toEqual(Array(5).fill('0.4000'));
    expect(result.table.coverage.map((entry) => entry.summary)).toEqual(['FY2021–FY2025 (5 of 5 years)', 'FY2021–FY2025 (5 of 5 years)']);
    expect(result.table.asks).toEqual([]);
  });

  it('leaves a part year out and asks the seller for every missing year, never extrapolating', () => {
    const result = packHistory(SPEC, [...months({ 2024: '0.01', 2025: '0.01' }, { skip: '2024-06' }), ...pnl(['2025'])]);
    expect(result.drivers.get('volume')?.map((year) => year.year)).toEqual(['2025']);
    expect(result.table.rows.find((row) => row.key === 'volume')?.values).toEqual([null, null, null, null, '1200.00']);
    expect(result.table.coverage.map((entry) => entry.summary)).toEqual([
      'FY2025 (1 of 5 years): ask the seller for FY2021–FY2024 income statements',
      'FY2025 (1 of 5 years): ask the seller for FY2021–FY2024 test export history',
    ]);
    expect(result.table.asks).toEqual([
      { needs: ['INCOME_STATEMENT'], note: 'Ask the seller for FY2021–FY2024 income statements.' },
      { needs: ['TEST_EXPORT'], note: 'Ask the seller for FY2021–FY2024 test export history.' },
    ]);
    const metric = withHistory({ key: 'volume', label: 'Volume', unit: 'MONEY', value: '1200.00', formula: '', sourceCount: 12 }, result, 'volume');
    expect(metric.coverage).toBe('FY2025 (1 of 5 years): ask the seller for FY2021–FY2024');
    expect(metric.history?.map((point) => point.value)).toEqual([null, null, null, null, '1200.00']);
  });

  it('with nothing imported, reads nothing and asks for nothing yet', () => {
    const result = packHistory(SPEC, []);
    expect(result.expected).toEqual([]);
    expect(result.table.years).toEqual([]);
    expect(result.table.asks).toEqual([]);
  });

  describe('the driver trend rule', () => {
    const rule = driverTrendRule({ id: 'test-rate-trend', driver: RATE, adverse: 'DOWN', threshold: '0.001', domain: 'FINANCIAL', advice: 'Check pricing.' }, SPEC);
    const detect = (rates: Readonly<Record<string, string>>) => rule.detect({ evidence: months(rates), pages: [] });

    it('drafts a −1 when the driver moves the adverse way every year by the threshold or more, citing the rows', () => {
      const [proposal, ...rest] = detect({ 2021: '0.011', 2022: '0.010', 2023: '0.009', 2024: '0.008', 2025: '0.007' });
      expect(rest).toEqual([]);
      expect(proposal).toMatchObject({ key: 'rate:2021-2025', title: 'Take rate falling every year, FY2021–FY2025', direction: -1, pricedRisk: null, domain: 'FINANCIAL' });
      expect(proposal?.description).toContain('FY2021 1.1%, FY2022 1.0%, FY2023 0.9%, FY2024 0.8%, FY2025 0.7%');
      expect(proposal?.description).toContain('0.40 points');
      expect(proposal?.evidenceIds.length).toBeGreaterThan(0);
    });

    it('drafts nothing when one year moves the other way, the move is small, or there are fewer than three years', () => {
      expect(detect({ 2021: '0.011', 2022: '0.012', 2023: '0.009', 2024: '0.008', 2025: '0.007' })).toEqual([]);
      expect(detect({ 2021: '0.0100', 2022: '0.0099', 2023: '0.0098' })).toEqual([]);
      expect(detect({ 2024: '0.011', 2025: '0.007' })).toEqual([]);
    });

    it('reads the latest run of consecutive years only', () => {
      // 2021 is cut off by the 2022 gap; 2023–2025 still fall every year.
      const [proposal] = detect({ 2021: '0.020', 2023: '0.011', 2024: '0.009', 2025: '0.007' });
      expect(proposal?.key).toBe('rate:2023-2025');
    });
  });
});
