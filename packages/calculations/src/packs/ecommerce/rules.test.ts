import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence } from '../rule-types';
import { ECOMMERCE_CHANNEL_CAC_RISING, ECOMMERCE_COHORT_REPEAT_DECLINE, ECOMMERCE_MARKETPLACE_MAJORITY } from './rules';

const row = (evidenceType: string, id: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });

describe('e-commerce rules (T-065)', () => {
  it('a marketplace majority needs the seller terms that let it change fees or delist', () => {
    const line = (id: string, name: string, amount: string) => row('billing.invoice_line', id, { customer_name: name, amount, currency: 'USD', period_start: '2026-09-01' });
    const evidence = [line('a', 'Marketvale marketplace payouts', '600'), line('b', 'Own web store', '400')];
    const terms = [{ documentId: 't', pageNumber: 2, text: "7. Marketvale may change fees, ranking or delist products on thirty days' notice." }];
    expect(ECOMMERCE_MARKETPLACE_MAJORITY.detect({ evidence, pages: terms })[0]?.description).toMatch(/^Marketvale marketplace payouts is 60\.0% of September 2026 revenue/);
    expect(ECOMMERCE_MARKETPLACE_MAJORITY.detect({ evidence, pages: [] })).toEqual([]);
    // The largest is the own store, and the marketplace is not a majority.
    expect(ECOMMERCE_MARKETPLACE_MAJORITY.detect({ evidence: [line('a', 'Marketvale marketplace payouts', '400'), line('b', 'Own web store', '600')], pages: terms })).toEqual([]);
  });

  it('cohort decline finds the first cohort from which every one is materially below all earlier cohorts', () => {
    const cohort = (month: string, kept: string) => [
      row('ecommerce.cohort_month', `${month}-0`, { first_purchase_month: month, months_since_first: '0', active_customers: '1000' }),
      row('ecommerce.cohort_month', `${month}-1`, { first_purchase_month: month, months_since_first: '1', active_customers: kept }),
    ];
    const evidence = [...cohort('2025-01', '390'), ...cohort('2025-04', '389'), ...cohort('2025-07', '270'), ...cohort('2025-10', '268')];
    const [found] = ECOMMERCE_COHORT_REPEAT_DECLINE.detect({ evidence, pages: [] });
    expect(found?.description).toMatch(/^Cohorts from July 2025 keep 26\.9% of customers in their second month, against 39\.0% for the 2 earlier cohorts/);
    expect(ECOMMERCE_COHORT_REPEAT_DECLINE.detect({ evidence: [...cohort('2025-01', '390'), ...cohort('2025-04', '380')], pages: [] })).toEqual([]);
  });

  it('a channel whose spend rises while new customers fall, month after month', () => {
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
    const evidence = months.flatMap((month, index) => [
      row('ecommerce.ad_spend_month', `p${index}`, { month, channel: 'paid social', spend: String(1000 + index * 100), new_customers: String(50 - index * 5) }),
      row('ecommerce.ad_spend_month', `s${index}`, { month, channel: 'search', spend: '500', new_customers: '25' }),
    ]);
    const found = ECOMMERCE_CHANNEL_CAC_RISING.detect({ evidence, pages: [] });
    expect(found.map((entry) => entry.title)).toEqual(['Acquisition cost rising on paid social']);
    expect(found[0]?.description).toContain('went from 20.00 in January 2026 to 60.00 in June 2026 (200.0% higher)');
  });
});
