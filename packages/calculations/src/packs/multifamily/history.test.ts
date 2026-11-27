import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence } from '../rule-types';
import { cagr, HISTORY_YEARS, multifamilyHistory, yearRanges } from './history';
import { MULTIFAMILY_NOI_SPIKE, MULTIFAMILY_OCCUPANCY_EROSION, MULTIFAMILY_RENT_BELOW_EXPENSE_GROWTH } from './history-rules';
import { multifamilyMetrics } from './metrics';

let seq = 0;
const row = (evidenceType: string, canonical: Record<string, string>): PackRuleEvidence => {
  seq += 1;
  const id = `0190f000-0000-7000-8000-${String(seq).padStart(12, '0')}`;
  return { id, evidenceType, sourceRecordId: id, canonical };
};
/** A P&L year as the import stores it: one row per line, the year as the period, the kind a person confirmed. */
const pnlYear = (year: string, lines: Record<string, [kind: string, amount: string]>) =>
  Object.entries(lines).map(([account, [kind, amount]]) => row('finance.pnl_line', { account, month: year, amount, line_kind: kind }));
const month = (start: string, offset: number) => {
  const [y = 0, m = 1] = start.split('-').map(Number);
  const index = y * 12 + m - 1 + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};
/** Twelve months of occupancy for the year ending September `fy`: `occupied` of 100 units, at `rent` a month. */
const occupancyYear = (fy: number, occupied: number, rent: string, low = occupied) =>
  Array.from({ length: 12 }, (_, index) =>
    row('property.occupancy_period', { period: month(`${fy - 1}-10`, index), unit_type: 'All', units: '100', occupied_units: String(index === 6 ? low : occupied), average_rent: rent, concessions: '500.00' }),
  );

// NOI 100,000 growing 10% a year (146,410 after four): revenue 200,000 growing 5%.
const revenue = ['200000.00', '210000.00', '220500.00', '231525.00', '243101.25'];
const noi = ['100000.00', '110000.00', '121000.00', '133100.00', '146410.00'];
const repairs = ['10000.00', '12000.00', '14400.00', '17280.00', '20736.00'];
const fiveYears = ['2022', '2023', '2024', '2025', '2026'].flatMap((year, index) =>
  pnlYear(year, {
    'Rental revenue': ['REVENUE', revenue[index] ?? '0'],
    'Repairs and maintenance': ['OPEX', repairs[index] ?? '0'],
    'Property taxes': ['OPEX', (Number(revenue[index]) - Number(noi[index]) - Number(repairs[index])).toFixed(2)],
  }),
);
const occupancy = [...occupancyYear(2022, 96, '1000.00'), ...occupancyYear(2023, 95, '1030.00'), ...occupancyYear(2024, 93, '1060.90'), ...occupancyYear(2025, 91, '1092.73'), ...occupancyYear(2026, 89, '1125.51', 87)];

describe('multifamily history (T-183)', () => {
  it('reads five years side by side, with growth rates matching hand-computed values', () => {
    const history = multifamilyHistory([...fiveYears, ...occupancy], 'USD');
    expect(history.expected).toEqual(['2022', '2023', '2024', '2025', '2026']);
    expect(history.operating.map((year) => [year.year, year.basis, year.noi, year.expenseRatio])).toEqual([
      ['2022', 'STATED', '100000.00', '0.5000'],
      ['2023', 'STATED', '110000.00', '0.4762'],
      ['2024', 'STATED', '121000.00', '0.4512'],
      ['2025', 'STATED', '133100.00', '0.4251'],
      ['2026', 'STATED', '146410.00', '0.3977'],
    ]);
    expect(history.noiCagr).toBe('0.1000');
    expect(history.revenueCagr).toBe('0.0500');
    expect(history.rentCagr).toBe('0.0300');
    expect(history.occupancy.map((year) => [year.year, year.average, year.low])).toEqual([
      ['2022', '0.9600', '0.9600'],
      ['2023', '0.9500', '0.9500'],
      ['2024', '0.9300', '0.9300'],
      ['2025', '0.9100', '0.9100'],
      ['2026', '0.8883', '0.8700'],
    ]);
    // 1 − the mean of the last three years' averages: 1 − (0.9300 + 0.9100 + 0.8883) ÷ 3.
    expect(history.trailingVacancy.value).toBe('0.0906');
    expect(history.coverage.operating.summary).toBe('FY2022–FY2026 (5 years; earlier years not provided)');
  });

  it('accepts less history and states it: two years give "2 of 5 years" and an ask of the seller, nothing extrapolated', () => {
    const two = [...fiveYears.filter((line) => ['2025', '2026'].includes(line.canonical['month'] ?? '')), ...occupancy.slice(36)];
    const report = multifamilyMetrics({ currency: 'USD', evidence: two });
    const metric = Object.fromEntries(report.metrics.map((entry) => [entry.key, entry]));
    expect(metric['noi_latest']?.coverage).toBe('FY2025–FY2026 (2 of 5 years): ask the seller for FY2022–FY2024 operating statements, or tell us the business started later');
    expect(metric['noi_latest']?.history?.map((point) => point.value)).toEqual([null, null, null, '133100.00', '146410.00']);
    // Growth over the one year imported, never over five.
    expect(metric['noi_cagr']?.value).toBe('0.1000');
    expect(report.history?.years).toEqual(['FY2022', 'FY2023', 'FY2024', 'FY2025', 'FY2026']);
    expect(report.history?.asks).toEqual([
      { needs: ['INCOME_STATEMENT'], note: 'Ask the seller for FY2022–FY2024 operating statements, or tell us the business started later.' },
      { needs: ['MULTIFAMILY_OCCUPANCY'], note: 'Ask the seller for FY2022–FY2024 occupancy and rent history, or tell us the business started later.' },
    ]);
    // With the property acquired in FY2025 (its history start), two years are the whole history: no ask.
    const started = multifamilyMetrics({ currency: 'USD', evidence: two, historyStartYear: 2025 });
    const startedMetric = Object.fromEntries(started.metrics.map((entry) => [entry.key, entry]));
    expect(startedMetric['noi_latest']?.coverage).toBe('FY2025–FY2026 (2 of 2 years since the business started)');
    expect(started.history?.years).toEqual(['FY2025', 'FY2026']);
    expect(started.history?.asks).toEqual([]);
    expect(started.history?.historyStartYear).toBe(2025);
    expect(report.history?.rows.find((entry) => entry.key === 'noi')?.values).toEqual([null, null, null, '133100.00', '146410.00']);
  });

  it('reads a monthly P&L in twelve-month years and the T-12 as the current year', () => {
    const t12 = Array.from({ length: 12 }, (_, index) => row('multifamily.t12_month', { month: month('2025-10', index), rental_income: '1000.00', other_income: '0.00', operating_expenses: '400.00', net_operating_income: '600.00' }));
    const monthly = Array.from({ length: 12 }, (_, index) => row('finance.pnl_line', { account: 'Rent', month: month('2024-10', index), amount: '900.00', line_kind: 'REVENUE' }));
    const history = multifamilyHistory([...t12, ...monthly], 'USD');
    expect(history.operating.map((year) => [year.year, year.basis, year.revenue, year.noi])).toEqual([
      ['2025', 'MONTHS', '10800.00', '10800.00'],
      ['2026', 'T12', '12000.00', '7200.00'],
    ]);
    expect(history.coverage.operating.present).toEqual(['2025', '2026']);
    // Rent-roll snapshots, one each quarter, make an occupancy year; fewer leave it out as a part year.
    const snap = (asOf: string, status: string) => row('multifamily.unit_snapshot', { as_of: asOf, unit: `U-${asOf}-${status}`, status, in_place_rent: status === 'occupied' ? '1000.00' : '0.00' });
    const quarters = ['2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30'].flatMap((asOf) => [snap(asOf, 'occupied'), snap(asOf, 'vacant')]);
    const snapshots = multifamilyHistory([...quarters, snap('2025-06-30', 'occupied')], 'USD');
    expect(snapshots.occupancy.map((year) => [year.year, year.basis, year.average, year.averageRent])).toEqual([['2026', 'QUARTERLY', '0.5000', '1000.00']]);
    expect(snapshots.partial.occupancy).toEqual(['2025']);
  });

  it('drafts occupancy erosion, rent below expense growth and the last-year spike, each cited; a re-run gives the same keys', () => {
    const evidence = [...fiveYears, ...occupancy];
    const erosion = MULTIFAMILY_OCCUPANCY_EROSION.detect({ evidence, pages: [] });
    expect(erosion).toHaveLength(1);
    expect(erosion[0]).toMatchObject({ key: '2022-2026', title: 'Occupancy eroding, FY2022–FY2026', direction: -1, severity: 'HIGH', pricedRisk: null });
    expect(erosion[0]?.evidenceIds.length).toBeGreaterThan(0);
    // Repairs grow 20% a year against rent's 3%; total expenses grow 0.7% a year, so only repairs draft.
    const growth = MULTIFAMILY_RENT_BELOW_EXPENSE_GROWTH.detect({ evidence, pages: [] });
    expect(growth.map((proposal) => proposal.title)).toEqual(['Repairs and maintenance growing faster than rent, FY2022–FY2026']);
    expect(growth[0]?.evidenceIds.length).toBeGreaterThan(0);
    // Steady 10% growth is no spike.
    expect(MULTIFAMILY_NOI_SPIKE.detect({ evidence, pages: [] })).toEqual([]);
    const spiked = [...fiveYears.filter((line) => line.canonical['month'] !== '2026'), ...pnlYear('2026', { 'Rental revenue': ['REVENUE', '243101.25'], 'Property taxes': ['OPEX', '60000.00'], 'Insurance premium refund (one-off)': ['OPEX', '-5000.00'] })];
    const spike = MULTIFAMILY_NOI_SPIKE.detect({ evidence: spiked, pages: [] });
    expect(spike[0]).toMatchObject({ key: '2026', title: "NOI jump in FY2026 above the history's trend", direction: -1 });
    expect(spike[0]?.description).toContain('Insurance premium refund (one-off)');
    expect(MULTIFAMILY_NOI_SPIKE.detect({ evidence: spiked, pages: [] })[0]?.key).toBe(spike[0]?.key);
  });

  it('expects five years and words coverage plainly', () => {
    expect(HISTORY_YEARS).toBe(5);
    expect(yearRanges(['2022', '2023', '2025'])).toBe('FY2022–FY2023, FY2025');
    expect(cagr('100', '121', 2)).toBe('0.1000');
    expect(cagr('0', '121', 2)).toBeNull();
  });
});
