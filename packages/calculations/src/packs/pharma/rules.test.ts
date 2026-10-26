import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence } from '../rule-types';
import { PHARMA_PARTNER_CONCENTRATION, PHARMA_PATENT_BEFORE_FORECAST } from './rules';

const patent = (id: string, product: string, type: string, expiry: string): PackRuleEvidence => ({
  id,
  evidenceType: 'pharma.patent',
  sourceRecordId: id,
  canonical: { family: id, product, jurisdiction: 'US', type, expiry },
});
const forecast = [{ documentId: 'f', pageNumber: 1, text: 'Product A royalties are forecast to grow 4% a year, assuming market exclusivity through 2031.' }];

describe('pharma rules (T-064)', () => {
  it('core patents expiring before the assumed exclusivity draft a cited finding; later formulation patents do not save it', () => {
    const evidence = [patent('PF-01', 'Product A', 'composition of matter', '2028-03-31'), patent('PF-02', 'Product A', 'formulation', '2033-11-30'), patent('PF-03', 'Product B', 'method of use', '2031-08-31')];
    const [found, ...rest] = PHARMA_PATENT_BEFORE_FORECAST.detect({ evidence, pages: forecast });
    expect(rest).toEqual([]);
    expect(found).toMatchObject({ key: 'Product A:2031', evidenceIds: ['PF-01'] });
    expect(found?.description).toBe(
      'The forecast assumes Product A exclusivity through 2031; its composition-of-matter patents expire by 2028-03-31 (PF-01 US 2028-03-31). Later formulation patents give narrower protection.',
    );
    // Core protection through the assumed year: nothing to draft.
    expect(PHARMA_PATENT_BEFORE_FORECAST.detect({ evidence: [patent('PF-01', 'Product A', 'composition of matter', '2032-01-31')], pages: forecast })).toEqual([]);
  });

  it('partner concentration groups a partner’s lines and names the largest', () => {
    const line = (id: string, name: string, amount: string): PackRuleEvidence => ({ id, evidenceType: 'billing.invoice_line', sourceRecordId: id, canonical: { customer_name: name, amount, currency: 'USD', period_start: '2026-09-01' } });
    const evidence = [line('a', 'Aldermoor — royalties', '500'), line('b', 'Aldermoor — supply', '200'), line('c', 'Kingsway — royalties', '300')];
    const [found] = PHARMA_PARTNER_CONCENTRATION.detect({ evidence, pages: [] });
    expect(found?.description).toMatch(/^Aldermoor is 70\.0% of September 2026 revenue \(USD 1,000 in the month\)\. Its largest line, Aldermoor — royalties, is 50\.0%\./);
    expect(found?.evidenceIds).toEqual(['a', 'b']);
  });
});
