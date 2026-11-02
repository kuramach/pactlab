import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence } from '../rule-types';
import { monthlyRevenue, SAAS_CUSTOMER_CHANGE_OF_CONTROL, SAAS_HIDDEN_CONTRACTION, SAAS_REPORTED_ARR, SAAS_REVENUE_CONCENTRATION } from './rules';

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
const line = (customer: string, month: string, amount: string, interval = 'month'): PackRuleEvidence => ({
  id: `${customer}-${month}`,
  evidenceType: 'billing.invoice_line',
  sourceRecordId: `${customer}-${month}`,
  canonical: { customer_name: customer, amount, currency: 'USD', interval, interval_count: '1', period_start: `${month}-01` },
});
// Synthetic: Alder pays 1,000 throughout; Birch drops from 500 to 300 in April; Cedar stops after March; Dune prepays a year in January.
const evidence = [
  ...MONTHS.map((month) => line('Alder Co (synthetic)', month, '1000.00')),
  ...MONTHS.map((month) => line('Birch Co (synthetic)', month, month >= '2026-04' ? '300.00' : '500.00')),
  ...MONTHS.slice(0, 3).map((month) => line('Cedar Co (synthetic)', month, '200.00')),
  line('Dune Co (synthetic)', '2026-01', '2400.00', 'year'),
];
const kpi = [
  { documentId: 'kpi', pageNumber: 1, text: 'Annual recurring revenue (ARR) at 30 June 2026: USD 24,000\nLogo count: 4 active customers' },
  { documentId: 'msa', pageNumber: 2, text: "14. Change of control. Customer may terminate this agreement on thirty days' written notice if the Supplier undergoes a change of control." },
];

describe('software and SaaS rules', () => {
  it('spreads annual lines over their months and stops at the latest billed month', () => {
    const revenue = monthlyRevenue(evidence);
    expect(revenue?.latest).toBe('2026-06');
    expect(revenue?.total('2026-06').toFixed(2)).toBe('1500.00'); // 1,000 + 300 + 2,400 / 12
  });

  it('management ARR above billed ARR names the customers no longer billed', () => {
    const [found] = SAAS_REPORTED_ARR.detect({ evidence, pages: kpi });
    expect(found).toMatchObject({ key: '2026-06', title: 'Management ARR exceeds billed ARR', severity: 'HIGH', direction: -1 });
    expect(found?.description).toBe(
      "Management reports ARR of USD 24,000; billing supports USD 18,000 at June 2026 (that month's recurring revenue × 12) — USD 6,000 (33.3%) more than is billed. Billed in the last year but not in June 2026: Cedar Co (synthetic), last billed March 2026.",
    );
    expect(found?.quotes).toEqual([{ documentId: 'kpi', pageNumber: 1, quote: 'ARR) at 30 June 2026: USD 24,000' }]);
    expect(found?.evidenceIds).toContain('Cedar Co (synthetic)-2026-03');
    // Within 2%, or in another currency: nothing.
    expect(SAAS_REPORTED_ARR.detect({ evidence, pages: [{ documentId: 'k', pageNumber: 1, text: 'ARR at 30 June 2026: USD 18,200' }] })).toEqual([]);
    expect(SAAS_REPORTED_ARR.detect({ evidence, pages: [{ documentId: 'k', pageNumber: 1, text: 'ARR at 30 June 2026: EUR 24,000' }] })).toEqual([]);
  });

  it('revenue concentration takes the largest customer of the latest month', () => {
    const [found] = SAAS_REVENUE_CONCENTRATION.detect({ evidence, pages: [] });
    expect(found?.description).toMatch(/^Alder Co \(synthetic\) is 76\.9% of June 2026 revenue/);
  });

  it('a customer change-of-control termination right is quoted', () => {
    const [found] = SAAS_CUSTOMER_CHANGE_OF_CONTROL.detect({ evidence: [], pages: kpi });
    expect(found).toMatchObject({ title: 'Customer can terminate on change of control', domain: 'LEGAL', quotes: [{ documentId: 'msa', pageNumber: 2 }] });
  });

  it('contraction behind a flat logo count', () => {
    const [found] = SAAS_HIDDEN_CONTRACTION.detect({ evidence, pages: kpi });
    expect(found?.description).toBe(
      'Birch Co (synthetic) pays USD 300 a month in June 2026, 40.0% below USD 500 before April 2026. Management reports 4 active customers; billing has 3 in June 2026. A logo count does not show customers who stay but pay less.',
    );
    expect(found?.evidenceIds).toEqual(['Birch Co (synthetic)-2026-06']);
    expect(SAAS_HIDDEN_CONTRACTION.detect({ evidence, pages: [] })).toEqual([]);
  });
});
