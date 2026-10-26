import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence } from '../rule-types';
import { HOTELS_BRAND_PIP, HOTELS_REVPAR_GAP, HOTELS_SEASONAL_DEMAND } from './rules';

const month = (index: number) => `2026-${String(index + 1).padStart(2, '0')}`;

describe('hotels rules (T-067)', () => {
  it('prices the brand PIP at the estimate the franchise agreement states', () => {
    const pages = [{ documentId: 'f', pageNumber: 2, text: '16.4 Transfer. On any change of ownership the transferee must complete a property improvement plan (PIP). The current estimate of the PIP is USD 3,600,000.' }];
    const [found] = HOTELS_BRAND_PIP.detect({ evidence: [], pages });
    expect(found?.pricedRisk).toMatchObject({ type: 'REMEDIATION_COST', currency: 'USD', low: '3600000.00', high: '3600000.00' });
    expect(found?.quotes?.map((quote) => quote.quote)).toEqual(['The current estimate of the PIP is USD 3,600,000.', 'On any change of ownership the transferee must complete a property improvement plan (PIP).']);
  });

  it('RevPAR gap: drafted only when it widens to a material level', () => {
    const benchmark = (gaps: readonly number[]): PackRuleEvidence[] =>
      gaps.map((gap, index) => ({ id: month(index), evidenceType: 'hotels.benchmark_month', sourceRecordId: month(index), canonical: { month: month(index), revpar: String(100 - gap), comp_set_revpar: '100' } }));
    expect(HOTELS_REVPAR_GAP.detect({ evidence: benchmark([7, 8, 9, 10, 11, 12]), pages: [] })[0]?.description).toMatch(/by 7\.0% in January 2026, widening to 12\.0% by June 2026/);
    expect(HOTELS_REVPAR_GAP.detect({ evidence: benchmark([7, 7, 7, 7, 7, 8]), pages: [] })).toEqual([]);
  });

  it('seasonal demand compares the two strongest months with the weakest', () => {
    const revenue = [400, 450, 500, 550, 600, 700, 820, 780, 650, 600, 500, 450];
    const evidence = revenue.map((amount, index): PackRuleEvidence => ({ id: month(index), evidenceType: 'hotels.operating_month', sourceRecordId: month(index), canonical: { month: month(index), room_revenue: String(amount) } }));
    expect(HOTELS_SEASONAL_DEMAND.detect({ evidence, pages: [] })[0]?.description).toMatch(/^In the twelve months to December 2026, July and August room revenue is 2\.0× January's/);
  });
});
