import { describe, expect, it } from 'vitest';
import { METRIC_CALCULATORS } from '../calculators';
import type { PackMetricsReport } from '../metrics-types';
import type { PackRuleEvidence } from '../rule-types';
import { averageDailyCensusYears, HOSPITALS_ADMISSIONS_TREND } from './rules';

const row = (id: string, evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
const months = (year: string) => Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
/** A year of census: one service line, `admissions` a month at three days each. */
const censusYear = (year: string, admissions: number) =>
  months(year).map((month) => row(`C-${month}`, 'hospitals.census_month', { month, service_line: 'General medicine', admissions: String(admissions), patient_days: String(admissions * 3), average_daily_census: '0' }));
/** A year of payer mix: a government programme at 600 a month and a commercial plan at 400. */
const payerYear = (year: string, government = '600') =>
  months(year).flatMap((month) => [
    row(`G-${month}`, 'hospitals.payer_month', { month, payer: 'Government programme A (synthetic)', gross_charges: '0', net_revenue: government }),
    row(`K-${month}`, 'hospitals.payer_month', { month, payer: 'Commercial plan Keystone (synthetic)', gross_charges: '0', net_revenue: '400' }),
  ]);

describe('hospitals history (T-184c)', () => {
  it('reads the average daily census as patient days over the days in the year, complete years only', () => {
    // 2024 is a leap year: 100 × 3 × 12 ÷ 366; a part year is left out.
    expect(averageDailyCensusYears([...censusYear('2024', 100), ...censusYear('2025', 100), ...censusYear('2026', 100).slice(0, 9)]).map(({ year, value }) => [year, value])).toEqual([
      ['2024', '9.8'],
      ['2025', '9.9'],
    ]);
  });

  it('puts admissions, the average daily census and the government share by year beside the P&L', () => {
    const evidence = [...censusYear('2023', 120), ...censusYear('2024', 110), ...censusYear('2025', 100), ...payerYear('2023'), ...payerYear('2024'), ...payerYear('2025', '1600')];
    const report = METRIC_CALCULATORS['hospitals-operations']?.compute({ currency: 'USD', evidence } as never) as PackMetricsReport;
    const values = (key: string) => report.history?.rows.find((entry) => entry.key === key)?.values.slice(-3);
    expect(values('admissions')).toEqual(['1440', '1320', '1200']);
    expect(values('average_daily_census')).toEqual(['11.8', '10.8', '9.9']);
    expect(values('government_share')).toEqual(['0.6000', '0.6000', '0.8000']);
    expect(report.metrics.find((metric) => metric.key === 'average_daily_census')).toMatchObject({ value: '9.9', historyStrip: true });
    expect(report.metrics.find((metric) => metric.key === 'government_share')).toMatchObject({ value: '0.8000', historyStrip: true });
    // Admissions down 16.7% across three years, every year: drafted, citing the years' rows.
    const [found] = HOSPITALS_ADMISSIONS_TREND.detect({ evidence, pages: [] });
    expect(found).toMatchObject({ title: 'Admissions falling every year, FY2023–FY2025', direction: -1 });
    // Partial history states its coverage and asks the seller for the missing years.
    expect(report.history?.coverage.find((entry) => entry.key === 'drivers')?.summary).toContain('3 of 5 years');
    expect(report.history?.asks.find((ask) => ask.needs.includes('HOSPITALS_CENSUS'))?.needs).toEqual(['HOSPITALS_CENSUS', 'HOSPITALS_PAYER_MIX']);
  });
});
