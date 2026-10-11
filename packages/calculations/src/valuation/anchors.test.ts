import { describe, expect, it } from 'vitest';
import { anchorCounterPrice, type AnchorInput } from '.';

const anchor: AnchorInput = {
  id: 'a',
  name: 'Acquirer / Quayside 2025',
  kind: 'PRECEDENT_TRANSACTION',
  origin: 'ENTERED',
  enterpriseValue: '34000000',
  arr: '10000000',
  arrGrowth: '0.10',
  nrr: '0.98',
  grr: null,
  companyType: 'SOFTWARE_SAAS',
  announcedOn: '2025-06-01',
  currency: 'USD',
  arrBasis: 'ARR',
  sourceUrl: 'https://example.com/release',
};
const target = { arr: { amount: '268000', currency: 'USD' }, companyType: 'SOFTWARE_SAAS', arrGrowth: '0.05', nrr: '0.95' };
const ask = { amount: '1350000', currency: 'USD', basis: 'ENTERPRISE_VALUE' as const };
const run = (overrides: Partial<Parameters<typeof anchorCounterPrice>[0]> = {}) =>
  anchorCounterPrice({ anchor, target, asking: ask, bridge: null, today: '2026-10-11', ...overrides });

describe('anchorCounterPrice', () => {
  it('prices the target at the anchor multiple against an enterprise-value ask', () => {
    expect(run()).toEqual({
      version: 'anchors-1',
      multiple: '3.40',
      impliedEnterpriseValue: { amount: '911200.00', currency: 'USD' },
      counterPrice: { amount: '911200.00', currency: 'USD' },
      gap: { amount: '-438800.00', currency: 'USD' },
      gapRatio: '-0.3250',
      verdict: 'BELOW',
      flags: [],
    });
  });

  it('moves the counter-price to equity value with the bridge for an equity ask', () => {
    const bridge = { cash: '90000', debt: '120000', debtLikeItems: '35000', workingCapitalAdjustment: '-20000' };
    const result = run({ asking: { amount: '900000', currency: 'USD', basis: 'EQUITY_VALUE' }, bridge });
    expect(result).toMatchObject({ counterPrice: { amount: '826200.00' }, gap: { amount: '-73800.00' } });
    expect(run({ asking: { amount: '900000', currency: 'USD', basis: 'EQUITY_VALUE' } })).toEqual({ version: 'anchors-1', unavailable: 'NO_BRIDGE' });
  });

  it('flags every reason a seller could dismiss the anchor', () => {
    const weak = run({
      anchor: { ...anchor, arrGrowth: '0.40', nrr: '1.20', companyType: 'FINTECH', announcedOn: '2022-01-01', arrBasis: 'REVENUE', sourceUrl: null, origin: 'SYNTHETIC', enterpriseValue: '60000000', currency: 'EUR' },
    });
    expect('flags' in weak && weak.flags).toEqual([
      'GROWTH_GAP',
      'RETENTION_GAP',
      'DIFFERENT_COMPANY_TYPE',
      'OLDER_THAN_3_YEARS',
      'REVENUE_NOT_ARR',
      'NO_PUBLIC_SOURCE',
      'SYNTHETIC',
      'CURRENCY',
      'SUPPORTS_ASK',
    ]);
  });

  it('does not compare a target ARR and an ask in different currencies', () => {
    expect(run({ asking: { ...ask, currency: 'EUR' } })).toEqual({ version: 'anchors-1', unavailable: 'CURRENCY' });
  });
});
