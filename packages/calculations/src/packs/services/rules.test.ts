import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence } from '../rule-types';
import { SERVICES_CLIENT_TERMINATION, SERVICES_DELIVERY_ATTRITION, SERVICES_UTILIZATION_GAP } from './rules';

const row = (evidenceType: string, id: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });
const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

describe('professional services rules (T-063)', () => {
  it('utilization: billable ÷ available over the window against the reported rate', () => {
    const evidence = months.map((month) => row('services.timesheet_month', month, { month, team: 'Engineering', available_hours: '1000', billable_hours: '650' }));
    const pages = [{ documentId: 'm', pageNumber: 1, text: 'Billable utilization, trailing twelve months: 78%' }];
    const [found] = SERVICES_UTILIZATION_GAP.detect({ evidence, pages });
    expect(found?.description).toMatch(/^Management reports 78% utilization; timesheets give 65\.0% billable over 6 months to June 2026 — 13\.0 points lower/);
    expect(found?.severity).toBe('HIGH');
    expect(SERVICES_UTILIZATION_GAP.detect({ evidence, pages: [{ documentId: 'm', pageNumber: 1, text: 'Utilization: 66%' }] })).toEqual([]);
  });

  it('client termination needs the largest client, a convenience clause with notice, and an agreement naming the client', () => {
    const line = (id: string, name: string, amount: string) => row('billing.invoice_line', id, { customer_name: name, amount, currency: 'USD', period_start: '2026-09-01' });
    const evidence = [line('a', 'Meridian Retail Group (synthetic)', '400'), line('b', 'Halcyon Mutual (synthetic)', '600')].reverse();
    const msa = (client: string) => [
      { documentId: 'msa', pageNumber: 1, text: `Master services agreement with ${client}.` },
      { documentId: 'msa', pageNumber: 2, text: '18.2 Termination for convenience. The Client may terminate for convenience on sixty days’ written notice.' },
    ];
    const [found] = SERVICES_CLIENT_TERMINATION.detect({ evidence, pages: msa('Halcyon Mutual') });
    expect(found).toMatchObject({ evidenceIds: ['b'], quotes: [{ pageNumber: 2, quote: 'The Client may terminate for convenience on sixty days’ written notice.' }] });
    expect(found?.description).toMatch(/^Halcyon Mutual \(synthetic\) is 60\.0% of September 2026 revenue/);
    // The clause belongs to another client's agreement.
    expect(SERVICES_CLIENT_TERMINATION.detect({ evidence, pages: msa('Meridian Retail Group') })).toEqual([]);
  });

  it('delivery attrition: last quarter leavers at least double the first, aggregate counts only', () => {
    const leavers = ['1', '1', '1', '2', '3', '4'];
    const evidence = months.flatMap((month, index) => [
      row('services.headcount_month', `d${month}`, { month, role_family: 'Delivery', leavers: leavers[index] ?? '0', headcount: '100' }),
      row('services.headcount_month', `s${month}`, { month, role_family: 'Support functions', leavers: '5', headcount: '20' }),
    ]);
    const [found] = SERVICES_DELIVERY_ATTRITION.detect({ evidence, pages: [] });
    expect(found?.description).toMatch(/^Monthly delivery leavers rose from 1 in January 2026 to 4 in June 2026; annualised delivery attrition is 36\.0% over the last three months against 12\.0%/);
    expect(found?.evidenceIds.every((id) => id.startsWith('d'))).toBe(true);
  });
});
