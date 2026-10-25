import type { Finding } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import { findingsQuery, formatPricedRisk, fromDocumentReview, groupByDomain, needsPricing, parseFindingFilters } from './view';

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

describe('valuation direction labels', () => {
  it('names each direction and explains every refusal code', async () => {
    const { DIRECTION_LABELS, RULE_MESSAGES, directionText, directionVariant } = await import('./view');
    expect(directionText(null)).toBe('direction not decided');
    expect(directionText(-1)).toBe('drag');
    expect(directionText(1)).toBe('cushion');
    expect(directionVariant(-1)).toBe('danger');
    expect(DIRECTION_LABELS['1']?.help).toContain('not price paid');
    for (const code of ['DIRECTION_REQUIRED', 'DRAG_NEEDS_PRICE', 'CUSHION_NEEDS_DRIVER', 'NEUTRAL_NEEDS_RATIONALE', 'RATIONALE_REQUIRED']) {
      expect(RULE_MESSAGES[code]?.length ?? 0).toBeGreaterThan(20);
    }
  });
});

describe('register states (T-060, T-077)', () => {
  it('flags a drag without a price, and nothing else', () => {
    expect(needsPricing({ direction: -1, pricedRisk: null, status: 'DRAFT' })).toBe(true);
    expect(needsPricing({ direction: -1, pricedRisk: { type: 'ESCROW' }, status: 'DRAFT' })).toBe(false);
    expect(needsPricing({ direction: 0, pricedRisk: null, status: 'DRAFT' })).toBe(false);
    expect(needsPricing({ direction: -1, pricedRisk: null, status: 'REJECTED' })).toBe(false);
  });

  it('knows findings brought in from document review, and keeps the filters in the query', () => {
    expect(fromDocumentReview({ fingerprint: 'document:01900000-0000-7000-8000-000000000001' })).toBe(true);
    expect(fromDocumentReview({ fingerprint: 'pack:fintech-aml' })).toBe(false);
    const filters = parseFindingFilters({ deal: '01900000-0000-7000-8000-000000000001', source: 'document-review', pricing: 'needed' });
    expect(filters).toMatchObject({ source: 'document-review', pricing: 'needed' });
    // Pricing is a view over the list; only the API's own filters are sent.
    expect(findingsQuery(filters)).toBe('source=document-review');
  });
});
