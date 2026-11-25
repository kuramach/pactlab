import { describe, expect, it } from 'vitest';
import { D } from '../metrics/decimal';
import { irr, runWaterfall, WaterfallError, type PropertyPath, type WaterfallTerms } from './waterfall';

const terms = (overrides: Partial<WaterfallTerms> = {}): WaterfallTerms => ({
  prefRate: new D('0.08'),
  tiers: [
    { hurdle: new D('0.15'), gpShare: new D('0.30') },
    { hurdle: null, gpShare: new D('0.40') },
  ],
  acquisitionFee: new D(0),
  assetManagementFee: new D(0),
  dispositionFee: new D(0),
  ...overrides,
});

const path = (overrides: Partial<PropertyPath> = {}): PropertyPath => ({
  purchasePrice: new D(1000),
  loanAmount: new D(0),
  interestRate: new D(0),
  equity: new D(1000),
  holdYears: 1,
  noiYear1: new D(100),
  noiGrowth: new D(0),
  exitCapRate: new D('0.1'),
  sellingCosts: new D(0),
  ...overrides,
});

describe('syndication waterfall (T-106)', () => {
  it('pays the preferred return first, then splits inside the first tier (hand-worked)', () => {
    // Year 1: 100 operating + 1,000 sale = 1,100. Pref balance 1,080: LP 100 then 980.
    // The 15% tier needs 1,150 − 1,080 = 70 to the LP (100 gross); only 20 is left: LP 14, GP 6.
    const result = runWaterfall(terms(), path());
    expect(result.limitedPartners.distributed).toBe('1094.00');
    expect(result.sponsor.promote).toBe('6.00');
    expect(result.limitedPartners.irr).toBe('9.40');
    expect(result.limitedPartners.equityMultiple).toBe('1.09');
    expect(result.limitedPartners.averageCashOnCash).toBe('10.00');
  });

  it('fills the tier to its hurdle and splits the rest on the final tier (hand-worked)', () => {
    // Year 1: 300 operating to LP. Sale 3,000: 780 completes the pref, 100 gross fills the 15% tier
    // (LP 70, GP 30), the remaining 2,120 splits 60/40: LP 1,272, GP 848.
    const result = runWaterfall(terms(), path({ noiYear1: new D(300) }));
    expect(result.limitedPartners.distributed).toBe('2422.00');
    expect(result.sponsor.promote).toBe('878.00');
    expect(result.limitedPartners.irr).toBe('142.20');
  });

  it('takes fees out before distributions and holds the rest of the raise as reserves', () => {
    const result = runWaterfall(
      terms({ acquisitionFee: new D('0.02'), assetManagementFee: new D('0.01'), dispositionFee: new D('0.01') }),
      path({ purchasePrice: new D(1000), loanAmount: new D(500), equity: new D(600), interestRate: new D('0.05') }),
    );
    // Reserves: 600 − 500 − 20 = 80, returned at sale. Debt service 25; AM fee 6; disposition fee 10.
    expect(result.fees).toEqual({ acquisition: '20.00', assetManagement: '6.00', disposition: '10.00', total: '36.00' });
    expect(result.years[0]!.operatingCashFlow).toBe('69.00');
    expect(result.sale.reservesReturned).toBe('80.00');
    expect(result.sale.netProceeds).toBe('570.00');
  });

  it('compounds the hurdles across years and grows NOI', () => {
    const result = runWaterfall(terms(), path({ holdYears: 5, noiGrowth: new D('0.03'), noiYear1: new D(60), exitCapRate: new D('0.06') }));
    expect(result.years).toHaveLength(5);
    expect(result.years[4]!.noi).toBe('67.53');
    // Same cash flows as a check: the IRR must reprice them to zero.
    const flows = [new D(-1000), ...result.years.map((year, i) => new D(year.toLimitedPartners).plus(i === 4 ? new D(result.sale.toLimitedPartners) : 0))];
    const rate = irr(flows)!;
    expect(rate.times(100).toFixed(2)).toBe(result.limitedPartners.irr);
  });

  it('refuses terms and paths it cannot model', () => {
    expect(() => runWaterfall(terms({ tiers: [{ hurdle: new D('0.15'), gpShare: new D('0.3') }] }), path())).toThrow(WaterfallError);
    expect(() => runWaterfall(terms({ tiers: [{ hurdle: new D('0.05'), gpShare: new D('0.3') }, { hurdle: null, gpShare: new D('0.4') }] }), path())).toThrow(/rise above/);
    expect(() => runWaterfall(terms({ acquisitionFee: new D('0.2') }), path())).toThrow(/does not cover/);
    expect(() => runWaterfall(terms(), path({ holdYears: 0 }))).toThrow(/Hold/);
  });

  it('states its conventions and labels the result a scenario', () => {
    const result = runWaterfall(terms(), path());
    expect(result.version).toBe('syndication-waterfall-1');
    expect(result.conventions.join(' ')).toMatch(/not a projection or promise/);
  });
});
