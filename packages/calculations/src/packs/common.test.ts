import { describe, expect, it } from 'vitest';
import { documentClauseRule, moneyIn, revenueConcentrationRule } from './common';
import type { PackRuleEvidence } from './rule-types';

const line = (id: string, customer: string, amount: string, month = '2026-09'): PackRuleEvidence => ({
  id,
  evidenceType: 'billing.invoice_line',
  sourceRecordId: id,
  canonical: { customer_name: customer, amount, currency: 'USD', period_start: `${month}-01` },
});

describe('shared pack rule factories (T-061)', () => {
  it('drafts concentration on the latest month only, for the largest counterparty or a named group', () => {
    const evidence = [line('a', 'Big Co', '60'), line('b', 'Small Co', '40'), line('c', 'Small Co', '900', '2026-08')];
    const single = revenueConcentrationRule({ id: 'x', title: 'Concentration', domain: 'COMMERCIAL', threshold: '0.5', direction: 0, directionRationale: 'r' });
    const [found] = single.detect({ evidence, pages: [] });
    expect(found).toMatchObject({ description: expect.stringContaining('Big Co is 60.0% of September 2026 revenue'), evidenceIds: ['a'] });
    expect(revenueConcentrationRule({ id: 'x', title: 't', domain: 'COMMERCIAL', threshold: '0.7', direction: 0, directionRationale: 'r' }).detect({ evidence, pages: [] })).toEqual([]);
    const group = revenueConcentrationRule({ id: 'g', title: 't', domain: 'COMMERCIAL', threshold: '0.3', group: { match: /co$/i, label: 'Companies' }, direction: 0, directionRationale: 'r' });
    expect(group.detect({ evidence, pages: [] })[0]?.description).toContain('Companies are 100.0%');
  });

  it('cites every required sentence of a clause and prices from the stated amount', () => {
    const pages = [{ documentId: 'd', pageNumber: 2, text: 'Clause 16.4. On a change of ownership the brand requires a property improvement plan estimated at USD 3,600,000. Other text.' }];
    const rule = documentClauseRule({
      id: 'pip',
      title: 'PIP',
      domain: 'PROPERTY',
      severity: 'HIGH',
      direction: -1,
      sentences: [(sentence) => /property improvement plan/i.test(sentence)],
      description: ([quote]) => `Quote: ${quote}`,
      price: { type: 'REMEDIATION_COST', lowShare: '0.8', basis: 'The brand estimate.' },
    });
    const [found] = rule.detect({ evidence: [], pages });
    expect(found?.pricedRisk).toEqual({ type: 'REMEDIATION_COST', currency: 'USD', low: '2880000.00', high: '3600000.00', basis: 'The brand estimate.' });
    expect(found?.quotes?.[0]?.pageNumber).toBe(2);
    expect(rule.detect({ evidence: [], pages: [{ documentId: 'd', pageNumber: 1, text: 'Nothing here.' }] })).toEqual([]);
    expect(moneyIn('a fee of GBP 7,505 per month')).toMatchObject({ currency: 'GBP' });
  });
});
