import { describe, expect, it } from 'vitest';
import { clinicsMetrics, CLINICS_PNL_TREND } from './clinics';
import { pnlYears } from './pnl-trend';
import type { PackRuleEvidence } from './rule-types';

const line = (id: string, account: string, month: string, amount: string, kind: string): PackRuleEvidence => ({ id, evidenceType: 'finance.pnl_line', sourceRecordId: `${account}|${month}`, canonical: { account, month, amount, line_kind: kind } });
/** Three fiscal years: revenue up 6% a year, clinical supplies up 15% a year (the planted trend), staff costs steady. */
const statement = (years: readonly string[] = ['2024', '2025', '2026']) =>
  years.flatMap((year, index) => [
    line(`0${index}-rev`, 'Patient fees', year, ['2400000', '2544000', '2696640'][index] ?? '0', 'REVENUE'),
    line(`0${index}-sup`, 'Clinical supplies', year, ['-216000', '-248400', '-285660'][index] ?? '0', 'COGS'),
    line(`0${index}-lab`, 'Lab fees', year, ['-120000', '-127200', '-134832'][index] ?? '0', 'COGS'),
    line(`0${index}-staff`, 'Associate and staff costs', year, ['-1100000', '-1166000', '-1235960'][index] ?? '0', 'OPEX'),
  ]);

describe('the multi-year P&L trend (shared by every pack)', () => {
  it('reads every complete fiscal year, stated or rolled up from twelve months, never a partial one', () => {
    const months = Array.from({ length: 12 }, (_, index) => line(`m${index}`, 'Patient fees', `2027-${String(index + 1).padStart(2, '0')}`, '100', 'REVENUE'));
    const partial = line('p', 'Patient fees', '2028-01', '100', 'REVENUE');
    const years = pnlYears([...statement(), ...months, partial]);
    expect(years.map((year) => [year.year, year.revenue.toFixed(0)])).toEqual([['2024', '2400000'], ['2025', '2544000'], ['2026', '2696640'], ['2027', '1200']]);
  });

  it('a re-sent line for the same period is read once, the newer row', () => {
    const again = line('9-rev', 'Patient fees', '2024', '2400000', 'REVENUE');
    expect(pnlYears([...statement(['2024']), again])[0]?.period.sources.map((row) => row.evidenceId)).toContain('9-rev');
    expect(pnlYears([...statement(['2024']), again])[0]?.revenue.toFixed(0)).toBe('2400000');
  });

  it('supply costs outpacing revenue across three years surface; one year alone shows nothing', () => {
    const found = CLINICS_PNL_TREND.detect({ evidence: statement(), pages: [] });
    expect(found.map((entry) => entry.title)).toEqual(['Clinical supplies outpacing revenue']);
    expect(found[0]).toMatchObject({ domain: 'FINANCIAL', direction: -1, severity: 'MEDIUM', key: 'expense:supplies:2024–2026' });
    expect(found[0]?.description).toMatch(/^Clinical supplies grew faster than revenue in every year \(\+32\.2% against revenue \+12\.4% over 2024–2026\); their share of revenue rose 1\.6 points: 2024 216000 \(9\.0%\), 2025 248400 \(9\.8%\), 2026 285660 \(10\.6%\)\./);
    expect(found[0]?.evidenceIds).toEqual(['00-sup', '01-sup', '02-sup', '00-rev', '01-rev', '02-rev']);
    expect(CLINICS_PNL_TREND.detect({ evidence: statement(['2026']), pages: [] })).toEqual([]);
  });

  it('falling revenue and a margin falling by two points or more are drafted too', () => {
    const shrinking = ['2024', '2025'].flatMap((year, index) => [
      line(`${year}-r`, 'Patient fees', year, ['1000', '900'][index] ?? '0', 'REVENUE'),
      line(`${year}-c`, 'Lab fees', year, ['300', '300'][index] ?? '0', 'COGS'),
    ]);
    expect(CLINICS_PNL_TREND.detect({ evidence: shrinking, pages: [] }).map((entry) => entry.title)).toEqual([
      'Revenue falling across 2024–2025',
      'Gross margin falling across 2024–2025',
      'Operating margin falling across 2024–2025',
      'Lab fees outpacing revenue',
    ]);
  });

  it('the clinics calculator reports every imported year, and asks for the P&L when there is none', () => {
    const report = clinicsMetrics({ currency: 'USD', evidence: statement() });
    const value = (key: string) => report.metrics.find((metric) => metric.key === key)?.value;
    expect(report).toMatchObject({ calculator: 'clinics-metrics', version: 'clinics-metrics-1' });
    expect(value('pnl_years')).toBe('3');
    expect(value('revenue_2026')).toBe('2696640.00');
    expect(value('revenue_growth_2026')).toBe('0.0600');
    expect(value('supplies_ratio_2024')).toBe('0.0900');
    expect(value('supplies_ratio_2026')).toBe('0.1059');
    expect(report.metrics.find((metric) => metric.key === 'revenue_growth_2024')).toBeUndefined();
    const empty = clinicsMetrics({ currency: 'USD', evidence: [] });
    expect(empty.metrics.find((metric) => metric.key === 'pnl_years')).toMatchObject({ value: null, needs: ['FINANCIAL_PNL'] });
    expect(empty.metrics.find((metric) => metric.key === 'owner_collection_share')).toMatchObject({ value: null, needs: ['CLINICS_VISITS'] });
    expect(empty.metrics.find((metric) => metric.key === 'denial_rate')).toMatchObject({ value: null, needs: ['HEALTHCARE_CLAIMS_SUMMARY'] });
  });
});
