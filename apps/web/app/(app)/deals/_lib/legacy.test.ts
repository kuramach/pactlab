import { describe, expect, it } from 'vitest';
import { legacyDealPath } from './legacy';

const deal = '01900000-0000-7000-8000-00000000c003';

describe('legacyDealPath', () => {
  it('moves old section addresses into the deal, keeping other parameters', () => {
    expect(legacyDealPath('findings', { deal, status: 'DRAFT' })).toBe(`/deals/${deal}/findings?status=DRAFT`);
    expect(legacyDealPath('documents', { dealId: deal, documentId: 'x', page: '2' })).toBe(
      `/deals/${deal}/documents?documentId=x&page=2`,
    );
    expect(legacyDealPath('valuation', { deal })).toBe(`/deals/${deal}/valuation`);
  });

  it('sends anything without a valid deal to My deals', () => {
    expect(legacyDealPath('findings', {})).toBe('/deals');
    expect(legacyDealPath('findings', { deal: '../etc' })).toBe('/deals');
  });
});
