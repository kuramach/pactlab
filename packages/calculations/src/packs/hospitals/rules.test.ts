import { describe, expect, it } from 'vitest';
import type { PackRuleEvidence } from '../rule-types';
import { HOSPITALS_PAYER_CONCENTRATION, HOSPITALS_PHYSICIAN_DEPENDENCE, HOSPITALS_REGULATORY_CAPEX } from './rules';

describe('hospitals rules (T-069)', () => {
  it('prices committed capex from the amount after its label, not the first amount in the quote', () => {
    // No full stops between the lines: the cost report reads as one sentence.
    const pages = [{ documentId: 'c', pageNumber: 1, text: 'Total operating expenses: USD 36,200,000\nCommitted regulatory capital expenditure (fire-safety and seismic upgrades): USD 4,100,000' }];
    const [found] = HOSPITALS_REGULATORY_CAPEX.detect({ evidence: [], pages });
    expect(found?.pricedRisk).toMatchObject({ type: 'REMEDIATION_COST', currency: 'USD', low: '4100000.00', high: '4100000.00' });
  });

  it('payer concentration reads the latest month of the payer mix', () => {
    const row = (month: string, payer: string, net: string): PackRuleEvidence => ({ id: `${month}-${payer}`, evidenceType: 'hospitals.payer_month', sourceRecordId: `${month}|${payer}`, canonical: { month, payer, net_revenue: net } });
    const evidence = [row('2026-08', 'Commercial', '900'), row('2026-08', 'Government A', '100'), row('2026-09', 'Commercial', '400'), row('2026-09', 'Government A', '600')];
    const [found] = HOSPITALS_PAYER_CONCENTRATION.detect({ evidence, pages: [] });
    expect(found?.description).toMatch(/^Government A is 60\.0% of September 2026 net revenue/);
    expect(found?.evidenceIds).toEqual(['2026-08-Government A', '2026-09-Government A']);
  });

  it('physician dependence needs an aggregate share stated for physicians', () => {
    const dependence = (text: string) => HOSPITALS_PHYSICIAN_DEPENDENCE.detect({ evidence: [], pages: [{ documentId: 's', pageNumber: 1, text }] });
    expect(dependence('Cardiology: two interventional cardiologists perform about 80% of procedures.')).toHaveLength(1);
    expect(dependence('Cardiology volumes grew 8% in the year.')).toEqual([]);
  });
});
