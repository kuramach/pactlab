import type { Finding } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import { findingsQuery, formatPricedRisk, groupByDomain, parseFindingFilters } from './view';

describe('findings view helpers', () => {
  it('keeps only valid filters', () => {
    const deal = '01890a5d-ac96-774b-bcce-b302099a8057';
    expect(parseFindingFilters({ deal, status: 'ACCEPTED', domain: 'SECURITY' })).toEqual({
      dealId: deal,
      status: 'ACCEPTED',
      domain: 'SECURITY',
    });
    expect(parseFindingFilters({ deal: 'x', status: 'APPROVED', domain: ['nope'] })).toEqual({});
    expect(findingsQuery({ status: 'DRAFT', domain: 'KEY_PERSON' })).toBe(
      'status=DRAFT&domain=KEY_PERSON',
    );
  });

  it('formats priced risk from decimal strings without floating point', () => {
    expect(
      formatPricedRisk({
        type: 'ESCROW',
        currency: 'USD',
        low: '1250000',
        high: '9999999999999.99',
        basis: 'x',
      }),
    ).toBe('USD 1,250,000 – 9,999,999,999,999.99');
    expect(
      formatPricedRisk({ type: 'ESCROW', currency: 'EUR', low: '500', high: '500', basis: 'x' }),
    ).toBe('EUR 500');
    expect(formatPricedRisk(null)).toBe('Not priced');
  });

  it('groups findings by domain in review order', () => {
    const finding = (domain: Finding['domain']) => ({ domain }) as Finding;
    const groups = groupByDomain([finding('KEY_PERSON'), finding('SECURITY'), finding('SECURITY')]);
    expect(groups.map(([domain, items]) => [domain, items.length])).toEqual([
      ['SECURITY', 2],
      ['KEY_PERSON', 1],
    ]);
  });
});
