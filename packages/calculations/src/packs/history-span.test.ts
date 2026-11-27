import { describe, expect, it } from 'vitest';
import { packHistory, recentRunRule, type DriverSpec, type PackHistorySpec } from './history';
import { historyWindow, kindCoverage, longRunMetrics, MAX_HISTORY_YEARS, recentRunCheck, worstYear, type YearValue } from './history-span';
import { FINTECH_PNL_TREND } from './fintech/rules';
import type { PackRuleEvidence } from './rule-types';

const years = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, index) => String(first + index));
const series = (values: Readonly<Record<string, string>>): YearValue[] => Object.entries(values).map(([year, value]) => ({ year, value, evidenceIds: [`e:${year}`] }));

const RATE: DriverSpec = { key: 'rate', label: 'Take rate', unit: 'RATIO', evidenceType: 'test.month', mode: 'RATIO', numerator: ['revenue'], denominator: ['volume'], formula: 'Σ revenue ÷ Σ volume' };
const SPEC: PackHistorySpec = { drivers: [RATE], keyExpenses: [], driverImport: 'TEST_EXPORT', driverLabel: 'Test export', driverWhat: 'test export history' };
const pnl = (revenue: Readonly<Record<string, number>>, margin: Readonly<Record<string, number>> = {}): PackRuleEvidence[] =>
  Object.entries(revenue).flatMap(([year, amount]) => [
    { id: `p:${year}:r`, evidenceType: 'finance.pnl_line', sourceRecordId: `r|${year}`, canonical: { account: 'Revenue', month: year, amount: amount.toFixed(2), line_kind: 'REVENUE' } },
    { id: `p:${year}:c`, evidenceType: 'finance.pnl_line', sourceRecordId: `c|${year}`, canonical: { account: 'Costs', month: year, amount: (amount * (1 - (margin[year] ?? 0.4))).toFixed(2), line_kind: 'OPEX' } },
  ]);

describe('history of any length (T-185)', () => {
  it('reads every year provided, up to 30, and expects max(latest − 4, start) … latest', () => {
    const twenty = historyWindow(years(2007, 2026));
    expect(twenty.years).toEqual(years(2007, 2026));
    expect(twenty.expected).toEqual(years(2022, 2026));
    expect(twenty.recent).toEqual(years(2022, 2026));
    const long = historyWindow(years(1980, 2026));
    expect(long.years).toHaveLength(MAX_HISTORY_YEARS);
    expect(long.years[0]).toBe('1997');
    const young = historyWindow(['2025', '2026'], { historyStartYear: 2025 });
    expect(young.expected).toEqual(['2025', '2026']);
    expect(young.years).toEqual(['2025', '2026']);
    expect(historyWindow(['2025', '2026']).years).toEqual(years(2022, 2026));
  });

  it('words coverage: a long history, a young business, five years, and a gap asked for alone', () => {
    const at = (present: readonly string[], start?: number) => kindCoverage('operating', 'Income and expenses', 'income statements', historyWindow(present, { historyStartYear: start ?? null }), present);
    expect(at(years(2007, 2026)).summary).toBe('FY2007–FY2026 (20 years)');
    expect(at(['2025', '2026'], 2025).summary).toBe('FY2025–FY2026 (2 of 2 years since the business started)');
    expect(at(['2025', '2026'], 2025).ask).toBeNull();
    expect(at(years(2022, 2026)).summary).toBe('FY2022–FY2026 (5 years; earlier years not provided)');
    expect(at(['2025', '2026']).summary).toBe('FY2025–FY2026 (2 of 5 years): ask the seller for FY2022–FY2024 income statements, or tell us the business started later');
    const gap = at(years(2010, 2026).filter((year) => year !== '2019'));
    expect(gap.summary).toBe('FY2010–FY2018, FY2020–FY2026 (16 of 17 years): ask the seller for FY2019 income statements');
    expect(gap.missing).toEqual(['FY2019']);
    expect(gap.ask).toBe('Ask the seller for FY2019 income statements.');
    // A start set after the first year read: the years before it are never asked for.
    expect(at(['2024', '2026'], 2024).summary).toBe('FY2024, FY2026 (2 of 3 years): ask the seller for FY2025 income statements');
  });

  it('finds the worst year and its recovery to the prior peak, or says it has not recovered', () => {
    const revenue = series({ 2007: '100', 2008: '110', 2009: '88', 2010: '95', 2011: '105', 2012: '112', 2013: '120' });
    expect(worstYear(revenue, 'MONEY')).toMatchObject({ year: '2009', from: '2008', peakYear: '2008', fall: '0.2000', recoveredYear: '2012', yearsToRecover: 3 });
    expect(worstYear(series({ 2020: '100', 2021: '90', 2022: '95' }), 'MONEY')).toMatchObject({ year: '2021', recoveredYear: null, yearsToRecover: null });
    // Ratios fall in points.
    expect(worstYear(series({ 2020: '0.95', 2021: '0.88', 2022: '0.90' }), 'RATIO')).toMatchObject({ fall: '0.0700', peakYear: '2020' });
    expect(worstYear(series({ 2020: '1', 2021: '2' }), 'MONEY')).toBeNull();
  });

  it('computes 10-year and full-history growth, the worst year and through-cycle averages, matching hand-computed values', () => {
    // Revenue 100 in 2007, ×1.05 a year; 105 in 2008 falls 20% to 84 in 2009, then 92.40, 101.64 and 106.72 in 2012, past the peak.
    const revenue: Record<string, number> = {};
    let level = 100;
    for (const year of years(2007, 2026)) {
      level = year === '2007' ? 100 : year === '2009' ? level * 0.8 : year === '2010' || year === '2011' ? level * 1.1 : level * 1.05;
      revenue[year] = Math.round(level * 100) / 100;
    }
    const margins: Record<string, number> = Object.fromEntries(years(2007, 2026).map((year) => [year, Number(year) >= 2022 ? 0.5 : 0.4]));
    const history = packHistory(SPEC, pnl(revenue, margins));
    const metric = Object.fromEntries((history.table.longRun ?? []).map((entry) => [entry.key, entry]));
    const cagr = (from: number, to: number, periods: number) => ((to / from) ** (1 / periods) - 1).toFixed(4);
    expect(metric['revenue_cagr_10y']?.value).toBe(cagr(revenue['2017'] as number, revenue['2026'] as number, 9));
    expect(metric['revenue_cagr_full']?.value).toBe(cagr(revenue['2007'] as number, revenue['2026'] as number, 19));
    expect(metric['revenue_worst_year']).toMatchObject({ value: '0.2000', recovery: { fallYear: 'FY2009', peakYear: 'FY2008', recoveredYear: 'FY2012', years: 3 } });
    // Through the cycle: 15 years at 40% and 5 at 50% average 42.5%; the last five years average 50%.
    expect(metric['operating_margin_average_full']?.value).toBe('0.4250');
    expect(metric['operating_margin_average_recent']?.value).toBe('0.5000');
    expect(metric['revenue_cagr_full']?.coverage).toBe('FY2007–FY2026 (20 years)');
    expect(history.table.years).toHaveLength(20);
    // The five-year view is unchanged: the trend rules read the latest five years only.
    expect(history.operating.map((year) => year.year)).toEqual(years(2022, 2026));
    const trend = FINTECH_PNL_TREND.detect({ evidence: pnl(revenue, margins), pages: [] });
    expect(trend[0]?.key).toBe('years:2022,2023,2024,2025,2026');
    // With fewer than ten years, the 10-year rate says why it is missing.
    const five = longRunMetrics([{ key: 'revenue', label: 'Revenue', unit: 'MONEY', years: series({ 2022: '100', 2023: '110', 2024: '120', 2025: '130', 2026: '140' }), figures: ['GROWTH'] }], historyWindow(years(2022, 2026)));
    expect(five[0]).toMatchObject({ key: 'revenue_cagr_10y', value: null, unavailableReason: 'Needs 10 years or more; 5 read.' });
  });

  it('"the recent run is better than the long run" fires on a recent run well above the full history and stays quiet on a flat one', () => {
    const run = series(Object.fromEntries(years(2007, 2026).map((year) => [year, Number(year) >= 2022 ? '0.5000' : '0.4000'])));
    const proposal = recentRunCheck('operating_margin', 'Operating margin (EBITDA)', run, 'FINANCIAL');
    expect(proposal).toMatchObject({ key: 'operating_margin:2007-2026', direction: -1, pricedRisk: null, title: 'The recent run is better than the long run: Operating margin (EBITDA), FY2022–FY2026 against FY2007–FY2026' });
    expect(proposal?.description).toContain('averaged 50.0% across FY2022–FY2026, against 42.5%');
    expect(recentRunCheck('m', 'Margin', series(Object.fromEntries(years(2007, 2026).map((year) => [year, '0.4000']))), 'FINANCIAL')).toBeNull();
    // Five years alone are not a long run.
    expect(recentRunCheck('m', 'Margin', series({ 2022: '0.3', 2023: '0.3', 2024: '0.6', 2025: '0.6', 2026: '0.6' }), 'FINANCIAL')).toBeNull();
    // As a rule: one draft over the margin, the same key on a re-run.
    const rule = recentRunRule('test', SPEC);
    const revenue = Object.fromEntries(years(2007, 2026).map((year) => [year, 1000]));
    const margins = Object.fromEntries(years(2007, 2026).map((year) => [year, Number(year) >= 2022 ? 0.5 : 0.4]));
    const first = rule.detect({ evidence: pnl(revenue, margins), pages: [] });
    expect(first.map((entry) => entry.key)).toEqual(['operating_margin:2007-2026']);
    expect(rule.detect({ evidence: pnl(revenue, margins), pages: [] }).map((entry) => entry.key)).toEqual(first.map((entry) => entry.key));
    expect(rule.detect({ evidence: pnl(revenue), pages: [] })).toEqual([]);
  });
});
