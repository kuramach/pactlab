import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence } from '../rule-types';
import { TELECOM_CHURN_TURNING, TELECOM_REGIONAL_CONCENTRATION, TELECOM_REPORTED_SUBSCRIBERS } from './rules';

const subscribers = (month: string, count: number, region = 'North'): PackRuleEvidence => ({
  id: `${month}-${region}`,
  evidenceType: 'telecom.subscribers_month',
  sourceRecordId: `${month}|${region}|Fibre`,
  canonical: { month, region, plan: 'Fibre', billed_subscribers: String(count), arpu: '42.00' },
});
const kpi = [{ documentId: 'k', pageNumber: 1, text: 'Subscribers at 30 June 2026: 1,100\nMonthly churn: 0.9% (blended)' }];
// Grows to March, then falls every month (synthetic).
const series = [1000, 1010, 1020, 1015, 1005, 995, 985].map((count, index) => subscribers(`2026-0${index + 1}`, count));

describe('telecom rules (T-062)', () => {
  it('reported subscribers above the billed count draft a cited gap', () => {
    const [found] = TELECOM_REPORTED_SUBSCRIBERS.detect({ evidence: series, pages: kpi });
    expect(found).toMatchObject({ key: '2026-07', severity: 'HIGH', evidenceIds: ['2026-07-North'] });
    expect(found?.description).toContain('reports 1,100 subscribers; the billing extract bills 985 in July 2026 — 115 (11.7%)');
    expect(TELECOM_REPORTED_SUBSCRIBERS.detect({ evidence: series, pages: [{ documentId: 'k', pageNumber: 1, text: 'Subscribers at 30 June 2026: 990' }] })).toEqual([]);
  });

  it('churn turning: growth to a peak, then a decline every month since, against the reported rate', () => {
    const [found] = TELECOM_CHURN_TURNING.detect({ evidence: series, pages: kpi });
    expect(found?.description).toBe(
      'Billed subscribers grew about 1.0% a month to 1,020 in March 2026, then fell about 0.9% a month to 985 in July 2026. Management still reports 0.9% monthly churn.',
    );
    // A recovery breaks the run; no reported rate, no contrast.
    expect(TELECOM_CHURN_TURNING.detect({ evidence: [...series.slice(0, 6), subscribers('2026-07', 1000)], pages: kpi })).toEqual([]);
    expect(TELECOM_CHURN_TURNING.detect({ evidence: series, pages: [] })).toEqual([]);
  });

  it('regional concentration groups invoice lines by region', () => {
    const line = (id: string, name: string, amount: string): PackRuleEvidence => ({ id, evidenceType: 'billing.invoice_line', sourceRecordId: id, canonical: { customer_name: name, amount, currency: 'USD', period_start: '2026-09-01' } });
    const evidence = [line('a', 'North region — Fibre 500', '300'), line('b', 'North region — Fibre + TV', '200'), line('c', 'Valley region — Fibre 500', '400'), line('d', 'Lakes region — Fibre 500', '100')];
    const [found] = TELECOM_REGIONAL_CONCENTRATION.detect({ evidence, pages: [] });
    expect(found).toMatchObject({ evidenceIds: ['a', 'b'], description: expect.stringMatching(/^The North region is 50\.0% of September 2026 revenue \(USD 1,000/) });
  });
});
