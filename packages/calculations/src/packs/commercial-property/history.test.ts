import { describe, expect, it } from 'vitest';
import { METRIC_CALCULATORS } from '../calculators';
import type { PackMetricsReport } from '../metrics-types';
import type { PackRuleEvidence } from '../rule-types';
import { leaseReadings, rentChecks, statementRent } from './leases';
import { CRE_OCCUPANCY_TREND } from './rules';

const row = (id: string, evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
/** Twelve months of a year's leasing history, `leased` square feet of 1,000 each month at 10 a sq ft a month. */
const leasingYear = (year: string, leased: number, expiring = 0) =>
  Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`;
    return row(`L-${month}`, 'cre.leasing_month', { month, rentable_sqft: '1000', leased_sqft: String(leased), base_rent: String(leased * 10), expiring_sqft: index === 5 ? String(expiring) : '0' });
  });

describe('commercial property history (T-184c)', () => {
  it('reads occupancy, rent per square foot and expiries by year from the leasing history, with a History strip', () => {
    const evidence = [...leasingYear('2023', 1000, 200), ...leasingYear('2024', 900), ...leasingYear('2025', 950)];
    const report = METRIC_CALCULATORS['cre-leases']?.compute({ currency: 'USD', evidence } as never) as PackMetricsReport;
    const values = (key: string) => report.history?.rows.find((entry) => entry.key === key)?.values;
    expect(report.history?.years.slice(-3)).toEqual(['FY2023', 'FY2024', 'FY2025']);
    expect(values('occupancy')?.slice(-3)).toEqual(['1.0000', '0.9000', '0.9500']);
    // 10 a sq ft a month × 12.
    expect(values('rent_per_sqft')?.slice(-3)).toEqual(['120.00', '120.00', '120.00']);
    expect(values('expiring_sqft')?.slice(-3)).toEqual(['200', '0', '0']);
    const occupancy = report.metrics.find((metric) => metric.key === 'occupancy');
    expect(occupancy).toMatchObject({ value: '0.9500', historyStrip: true });
    expect(report.metrics.find((metric) => metric.key === 'rent_per_sqft')?.value).toBe('120.00');
    // Missing years are asked of the seller, by name.
    expect(JSON.stringify(report.history?.asks)).toContain('FY2021');
    expect(report.history?.asks.flatMap((ask) => ask.needs)).toContain('CRE_LEASING_HISTORY');
    // No leasing history: the figure names the import it needs.
    const empty = METRIC_CALCULATORS['cre-leases']?.compute({ currency: 'USD', evidence: [] } as never) as PackMetricsReport;
    expect(empty.metrics.find((metric) => metric.key === 'occupancy')).toMatchObject({ value: null, needs: ['CRE_LEASING_HISTORY'] });
  });

  it('drafts occupancy falling every year by 3 points or more; a dip that recovers is not a trend', () => {
    const falling = [...leasingYear('2023', 980), ...leasingYear('2024', 960), ...leasingYear('2025', 940)];
    const [found] = CRE_OCCUPANCY_TREND.detect({ evidence: falling, pages: [] });
    expect(found).toMatchObject({ title: 'Occupancy (leased ÷ rentable area) falling every year, FY2023–FY2025', domain: 'PROPERTY', direction: -1, pricedRisk: null });
    expect(found?.description).toContain('FY2023 98.0%, FY2024 96.0%, FY2025 94.0%');
    expect(CRE_OCCUPANCY_TREND.detect({ evidence: [...leasingYear('2023', 1000), ...leasingYear('2024', 950), ...leasingYear('2025', 1000)], pages: [] })).toEqual([]);
    expect(CRE_OCCUPANCY_TREND.detect({ evidence: [...leasingYear('2023', 990), ...leasingYear('2024', 985), ...leasingYear('2025', 980)], pages: [] })).toEqual([]);
  });

  it('compares a statement year with the leases only when every lease on file was in force all year', () => {
    const lease = {
      documentId: 'l1',
      pageNumber: 1,
      text: 'Lease agreement for Unit 1 at Example Park between Landlord Co as landlord and Anchor Co (synthetic) as tenant.\n\nThe term runs from 1 July 2021 to 30 June 2030.\nThe initial base rent is USD 10,000.00 per month.\nBase rent is fixed for the term.',
    };
    expect(leaseReadings([lease], ['Anchor Co (synthetic)'])).toHaveLength(1);
    const suite = row('U1', 'cre.lease', { tenant: 'Anchor Co (synthetic)', suite: 'U1', sqft: '1000', lease_start: '2021-07-01', lease_end: '2030-06-30', monthly_base_rent: '10000.00', monthly_market_rent: '10000.00' });
    const checks = rentChecks([suite], [lease], '2026-09-30');
    const pnl = (year: string) => row(`p${year}`, 'finance.pnl_line', { account: 'Base rent revenue', month: year, amount: '150000.00', line_kind: 'REVENUE' });
    // FY2021 began under an earlier lease that is not on file: it is not compared. FY2022 is: 150,000 against the 120,000 the lease makes due.
    const years = statementRent([suite, pnl('2021'), pnl('2022')], checks);
    expect(years.map((year) => year.year)).toEqual(['2022']);
    expect(years[0]?.leases.toFixed(2)).toBe('120000.00');
  });
});
