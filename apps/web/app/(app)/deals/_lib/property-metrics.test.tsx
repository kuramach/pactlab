import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../[dealId]/documents/actions', () => ({ requestFromSeller: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./market-rents-actions', () => ({ checkMarketRents: vi.fn() }));

import { marketRentsOffer, type MarketRentsStatus } from './market-rents';
import { HistoryStrip, HistoryTable, missingImports, needsLabel, PropertyMetricsCard, requestNote, START_QUESTION, withStartQuestion } from './property-metrics';

const report = {
  calculator: 'multifamily-metrics',
  version: 'multifamily-metrics-1',
  currency: 'USD',
  metrics: [
    { key: 'occupancy', label: 'Physical occupancy', unit: 'RATIO' as const, value: '0.9500', formula: 'Occupied units ÷ units on the rent roll', sourceCount: 120 },
    { key: 't12_noi', label: 'Net operating income (T-12)', unit: 'MONEY' as const, value: null, formula: 'Σ NOI', sourceCount: 0, unavailableReason: 'Import the T-12 operating statement.', needs: ['MULTIFAMILY_T12'] },
    { key: 'capex_per_door', label: 'Repair estimate per door', unit: 'MONEY' as const, value: null, formula: 'Σ repairs ÷ units', sourceCount: 0, unavailableReason: 'Import the inspections.', needs: ['MULTIFAMILY_INSPECTION'] },
  ],
};

describe('property metrics on Home (Kumar, 2026-11-25)', () => {
  it('says what a missing figure needs in plain words, and what to ask the seller', () => {
    expect(needsLabel(['MULTIFAMILY_T12'])).toMatch(/^the t-12/i);
    expect(needsLabel(['MULTIFAMILY_RENT_ROLL', 'MULTIFAMILY_INSPECTION'])).toMatch(/^the .+ and the /);
    expect(missingImports(report.metrics)).toEqual([
      { id: 'MULTIFAMILY_T12', metrics: ['Net operating income (T-12)'] },
      { id: 'MULTIFAMILY_INSPECTION', metrics: ['Repair estimate per door'] },
    ]);
    expect(requestNote(['MULTIFAMILY_T12'], ['Net operating income (T-12)'])).toContain('to work out net operating income (t-12)');
  });

  it('shows every figure with how it is worked out; a missing one asks the seller for it', () => {
    const html = renderToStaticMarkup(<PropertyMetricsCard dealId="d" report={report} canAsk requested={new Set()} />);
    expect(html).toContain('Property metrics');
    expect(html).toContain('95.00%');
    expect(html).toContain('Occupied units ÷ units on the rent roll · 120 records');
    expect(html).toContain('Ask the seller for it');
    expect(html).toContain('Ask the seller for all 2');
  });

  it('says when a file was already requested, and offers an import when there is no seller to ask', () => {
    const asked = renderToStaticMarkup(<PropertyMetricsCard dealId="d" report={report} canAsk requested={new Set(['MULTIFAMILY_T12'])} />);
    expect(asked).toContain('Requested from the seller');
    expect(asked).not.toContain('Ask the seller for all');
    const alone = renderToStaticMarkup(<PropertyMetricsCard dealId="d" report={report} canAsk={false} requested={new Set()} />);
    expect(alone).not.toContain('Ask the seller');
    expect(alone).toContain('Import it');
  });

  it('nothing for a pack without industry metrics', () => {
    expect(renderToStaticMarkup(<PropertyMetricsCard dealId="d" report={{ ...report, metrics: [] }} canAsk requested={new Set()} />)).toBe('');
  });
});

describe('market rents on the property metrics (T-158)', () => {
  const market = {
    ...report,
    metrics: [
      { key: 'loss_to_lease', label: 'Loss-to-lease (from the rent roll)', unit: 'RATIO' as const, value: '0.0500', formula: 'Σ(market − in-place) ÷ Σ market', sourceCount: 90, source: 'Rent roll' },
      { key: 'market_rent_annual', label: 'Market rent, annual (from RentCast)', unit: 'MONEY' as const, value: null, formula: 'Σ estimate × 12', sourceCount: 0, unavailableReason: 'Check rents against the market (RentCast).', needs: ['MARKET_RENTS'] },
    ],
  };
  const status: MarketRentsStatus = { available: true, source: 'RentCast', address: null, addressFrom: null, currencySupported: true, floorPlans: [{ key: '1BR', label: '1 bed', units: 40, occupied: 38, medianSquareFeet: '690', overCap: false, estimate: null }], unplannedUnits: 0, callsPerRetrieval: 10 };

  it('offers the retrieval instead of asking the seller, and asks for the address once', () => {
    expect(missingImports(market.metrics)).toEqual([]);
    const html = renderToStaticMarkup(<PropertyMetricsCard dealId="d" report={market} canAsk requested={new Set()} marketRents={marketRentsOffer(status)} />);
    expect(html).toContain('Check rents against the market');
    expect(html).toContain('Property address');
    expect(html).toContain('Needs market rents');
    expect(html).not.toContain('Ask the seller');
    expect(html).toContain('Source: Rent roll');
  });

  it('cites the estimates a market figure uses, and says why the check is unavailable', () => {
    const filled = { ...market, metrics: [{ ...market.metrics[1]!, value: '480000.00', needs: undefined, source: 'RentCast', evidenceIds: ['e1', 'e2'] }] };
    const offer = marketRentsOffer({ ...status, address: '1 Main St, Austin, TX 78701', addressFrom: 'PACT', floorPlans: [{ ...status.floorPlans[0]!, estimate: { evidenceId: 'e1', rent: '1700.00', rentRangeLow: '1600.00', rentRangeHigh: '1800.00', currency: 'USD', comparablesCount: 15, retrievedOn: '2026-11-25', source: 'RentCast', address: '1 Main St, Austin, TX 78701' } }] });
    const html = renderToStaticMarkup(<PropertyMetricsCard dealId="d" report={filled} canAsk requested={new Set()} marketRents={offer} />);
    expect(html).toContain('Source: RentCast');
    expect(html).toContain('href="/deals/d/evidence/e2"');
    expect(html).toContain('retrieved 2026-11-25');
    expect(html).not.toContain('Property address');
    expect(marketRentsOffer({ ...status, currencySupported: false }).blocked).toContain('USD only');
    expect(marketRentsOffer({ ...status, available: false }).blocked).toContain('not set up');
  });
});

describe('five years of history (T-183)', () => {
  const history = {
    version: 'multifamily-history-1',
    expectedYears: 5,
    years: ['FY2022', 'FY2023', 'FY2024', 'FY2025', 'FY2026'],
    rows: [
      { key: 'noi', label: 'Net operating income', unit: 'MONEY' as const, values: [null, null, null, '133100.00', '146410.00'] },
      { key: 'occupancy', label: 'Occupancy (average)', unit: 'RATIO' as const, values: [null, null, null, '0.9100', '0.8883'] },
    ],
    coverage: [{ key: 'operating', label: 'Operating statements', present: ['FY2025', 'FY2026'], missing: ['FY2022', 'FY2023', 'FY2024'], summary: 'FY2025–FY2026 (2 of 5 years): ask the seller for FY2022–FY2024 operating statements' }],
    asks: [{ needs: ['INCOME_STATEMENT'], note: 'Ask the seller for FY2022–FY2024 operating statements.' }],
    conventions: [],
  };
  const withHistory = {
    ...report,
    history,
    metrics: [
      {
        key: 'noi_latest',
        label: 'Net operating income (latest year)',
        unit: 'MONEY' as const,
        value: '146410.00',
        formula: 'Revenue less operating expenses for FY2026',
        sourceCount: 12,
        coverage: history.coverage[0]?.summary,
        history: history.years.map((period, index) => ({ period, value: history.rows[0]?.values[index] ?? null })),
      },
    ],
  };

  it('shows a History strip with its coverage, and asks the seller for the missing years', () => {
    const html = renderToStaticMarkup(<PropertyMetricsCard dealId="d" report={withHistory} canAsk requested={new Set()} />);
    expect(html).toContain('History');
    expect(html).toContain('aria-label="Net operating income (latest year), by year"');
    expect(html).toContain('FY2025–FY2026 (2 of 5 years): ask the seller for FY2022–FY2024 operating statements');
    expect(html).toContain('Ask the seller for FY2022–FY2024 operating statements.');
    expect(html).toContain('Ask the seller for them');
    expect(needsLabel(['INCOME_STATEMENT'])).toBe('the income statement (p&l)');
    const asked = renderToStaticMarkup(<PropertyMetricsCard dealId="d" report={withHistory} canAsk requested={new Set(['INCOME_STATEMENT'])} />);
    expect(asked).not.toContain('Ask the seller for them');
  });

  it('lays the years side by side, a year not imported as a dash', () => {
    const html = renderToStaticMarkup(<HistoryTable history={history} currency="USD" />);
    for (const year of history.years) expect(html).toContain(`>${year}</th>`);
    expect(html).toContain('Occupancy (average)');
    expect((html.match(/>—</g) ?? []).length).toBe(6);
    expect(html).toContain('Operating statements: FY2025–FY2026 (2 of 5 years)');
  });

  it('shows the strip on any pack figure that carries one (T-184), and not on one that does not', () => {
    const tpv = { key: 'tpv', label: 'Processed volume (TPV), trailing', unit: 'MONEY' as const, value: '1000.00', formula: 'Σ volume', sourceCount: 24 };
    const fintech = {
      ...report,
      calculator: 'fintech-payments',
      metrics: [
        { ...tpv, historyStrip: true, coverage: 'FY2021–FY2025 (5 of 5 years)', history: history.years.map((period) => ({ period, value: '900.00' })) },
        { ...tpv, key: 'transactions', label: 'Transactions, trailing', unit: 'COUNT' as const },
      ],
    };
    const html = renderToStaticMarkup(<PropertyMetricsCard dealId="d" report={fintech} canAsk requested={new Set()} />);
    expect(html).toContain('Industry metrics');
    expect(html).toContain('aria-label="Processed volume (TPV), trailing, by year"');
    expect(html).toContain('FY2021–FY2025 (5 of 5 years)');
    expect(html).not.toContain('aria-label="Transactions, trailing, by year"');
  });

  it('shows the last ten years in the strip, every year in a scrolling table, and the long-run figures (T-185)', () => {
    const years = Array.from({ length: 20 }, (_, index) => `FY${2007 + index}`);
    const strip = renderToStaticMarkup(
      <HistoryStrip metric={{ label: 'Occupancy', unit: 'RATIO', coverage: 'FY2007–FY2026 (20 years)', history: years.map((period) => ({ period, value: '0.9000' })) }} currency="USD" />,
    );
    expect(strip).toContain('The last 10 years shown; every year is in the years table on Finances.');
    expect(strip).toContain('FY2007–FY2026 (20 years)');
    const long = {
      ...history,
      years,
      rows: [{ key: 'noi', label: 'Net operating income', unit: 'MONEY' as const, values: years.map(() => '100.00') }],
      longRun: [{ key: 'noi_worst_year', label: 'Net operating income, worst year', unit: 'RATIO' as const, value: '0.3010', formula: 'The largest fall year on year', sourceCount: 3, note: 'Recovered to the FY2008 peak in FY2014 (5 years)', coverage: 'FY2007–FY2026 (20 years)' }],
    };
    const html = renderToStaticMarkup(<HistoryTable history={long} currency="USD" />);
    for (const year of years) expect(html).toContain(`>${year}</th>`);
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('min-w-max');
    expect(html).toContain('Over the full history');
    expect(html).toContain('Recovered to the FY2008 peak in FY2014 (5 years)');
  });

  it('asks once when the business began, only when no history start is set (T-185)', () => {
    expect(withStartQuestion('Ask the seller for FY2022–FY2024 operating statements, or tell us the business started later.')).toBe(`Ask the seller for FY2022–FY2024 operating statements, or tell us the business started later. ${START_QUESTION}`);
    expect(withStartQuestion('Ask the seller for FY2019 operating statements.')).toBe('Ask the seller for FY2019 operating statements.');
  });
});
