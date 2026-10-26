import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence } from '../rule-types';
import { CRE_ANCHOR_ROLLOVER, CRE_BELOW_MARKET_ANCHOR, CRE_CAM_UNDER_RECOVERY } from './rules';

const lease = (suite: string, tenant: string, end: string, base: string, market: string): PackRuleEvidence => ({
  id: suite,
  evidenceType: 'cre.lease',
  sourceRecordId: suite,
  canonical: { tenant, suite, lease_end: end, monthly_base_rent: base, monthly_market_rent: market },
});
const billed: PackRuleEvidence = { id: 'i', evidenceType: 'billing.invoice_line', sourceRecordId: 'i', canonical: { customer_name: 'Anchor Co', amount: '600', currency: 'USD', period_start: '2026-09-01' } };
const roll = [lease('U1', 'Anchor Co (synthetic)', '2027-09-30', '600', '660'), lease('U2', 'Small Co (synthetic)', '2030-09-30', '400', '400')];
const abstract = [{ documentId: 'a', pageNumber: 1, text: 'Lease abstract — Anchor Co.\n\nTerm ends 30 September 2027. Option to renew.' }];

describe('commercial property rules (T-066)', () => {
  it('anchor rollover: share of base rent, years left and rent-weighted WALT, confirmed by the abstract that names the tenant', () => {
    const [found] = CRE_ANCHOR_ROLLOVER.detect({ evidence: [...roll, billed], pages: abstract });
    // As of 2026-09-30: 1.0 years for U1, 4.0 for U2 → WALT (600×1 + 400×4) / 1000 = 2.2.
    expect(found?.description).toMatch(/^Anchor Co \(synthetic\) is 60\.0% of base rent and its lease ends 2027-09-30 \(1\.0 years after 2026-09-30\)\. Weighted average lease term is 2\.2 years\./);
    expect(CRE_ANCHOR_ROLLOVER.detect({ evidence: [...roll, billed], pages: [{ documentId: 'b', pageNumber: 1, text: 'Lease abstract — Other Co. Term ends 2027.' }] })).toEqual([]);
    expect(CRE_ANCHOR_ROLLOVER.detect({ evidence: roll, pages: abstract })).toEqual([]);
  });

  it('below-market anchor is upside only when it is the deepest discount on the roll', () => {
    const [found] = CRE_BELOW_MARKET_ANCHOR.detect({ evidence: roll, pages: [] });
    expect(found).toMatchObject({ direction: 1, valueConfirmation: { valueDriver: 'Below-market anchor rent' }, evidenceIds: ['U1'] });
    expect(found?.description).toContain('pays 9.1% below market rent');
    expect(CRE_BELOW_MARKET_ANCHOR.detect({ evidence: [roll[0] as PackRuleEvidence, lease('U2', 'Small Co', '2030-09-30', '300', '400')], pages: [] })).toEqual([]);
  });

  it('CAM under-recovery reads the latest year and only the short categories', () => {
    const cam = (year: string, category: string, expenses: string, recoveries: string): PackRuleEvidence => ({ id: `${year}-${category}`, evidenceType: 'cre.cam_category', sourceRecordId: `${year}|${category}`, canonical: { year, category, expenses, recoveries } });
    const evidence = [cam('2024', 'Security', '100', '50'), cam('2025', 'Security', '64000', '41000'), cam('2025', 'Insurance', '88000', '88000')];
    const [found] = CRE_CAM_UNDER_RECOVERY.detect({ evidence, pages: [] });
    expect(found).toMatchObject({ key: '2025', evidenceIds: ['2025-Security'] });
    expect(found?.description).toContain("23,000 a year in the deal's currency, 15.1% of CAM expenses");
  });
});
