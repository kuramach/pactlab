import { CLINICS_LEASE_TERM, CLINICS_OWNER_DEPENDENCE, CLINICS_PNL_TREND, CLINICS_REFERRAL_CONCENTRATION, HEALTHCARE_DENIALS_RISING, type PackRule, type PackRuleEvidence, type PackRulePage } from '@pactlab/calculations';
import { CLINICS_VISIT_EVIDENCE_TYPE, defaultDirectionFor, HEALTHCARE_CLAIMS_EVIDENCE_TYPE, PNL_LINE_EVIDENCE_TYPE, PREMISES_LEASE_EVIDENCE_TYPE } from '@pactlab/connectors';
import { describe, expect, it } from 'vitest';

const row = (evidenceType: string, id: string, canonical: Record<string, string>): PackRuleEvidence => ({ id, evidenceType, sourceRecordId: id, canonical });

const visits = ['2026-08', '2026-09'].flatMap((month) => [
  row('clinics.visit_month', `${month}-o`, { month, service_line: 'Implants', provider_ref: 'P01', provider_role: 'owner', referral_source: 'Harbourside Group', visits: '60', collections: '9000' }),
  row('clinics.visit_month', `${month}-a`, { month, service_line: 'Hygiene', provider_ref: 'P02', provider_role: 'associate', referral_source: 'Self-referred', visits: '40', collections: '2000' }),
]);
const claims = ['2026-01', '2026-04', '2026-07'].map((month, index) => row('healthcare.claims_month', month, { month, payer: 'A', claims: '100', denial_rate_pct: String(4 + index * 2) }));
const pnl = ['2024', '2025'].flatMap((year, index) => [
  row('finance.pnl_line', `${year}-r`, { account: 'Patient fees', month: year, amount: ['1000', '1050'][index] ?? '0', line_kind: 'REVENUE' }),
  row('finance.pnl_line', `${year}-s`, { account: 'Clinical supplies', month: year, amount: ['90', '110'][index] ?? '0', line_kind: 'COGS' }),
]);
const lease: PackRulePage[] = [{ documentId: 'l', pageNumber: 1, text: 'The term of this lease expires on 31 March 2028. Tenant has no option to renew or extend the term. The target closing date is 31 January 2027.' }];

/**
 * T-161: each new rule's input maps to its finding through VALUATION_DIRECTION_MAP — the direction a
 * rule proposes is the map's default for its evidence type and signal, and a +1 never appears (the
 * cushion asymmetry: these signals confirm no value and never raise a price).
 */
const CASES: readonly { rule: PackRule; evidence: readonly PackRuleEvidence[]; pages?: readonly PackRulePage[]; type: string; signal: string }[] = [
  { rule: CLINICS_OWNER_DEPENDENCE, evidence: visits, type: CLINICS_VISIT_EVIDENCE_TYPE, signal: 'owner-dependence' },
  { rule: CLINICS_REFERRAL_CONCENTRATION, evidence: visits, type: CLINICS_VISIT_EVIDENCE_TYPE, signal: 'referral-concentration' },
  { rule: HEALTHCARE_DENIALS_RISING, evidence: claims, type: HEALTHCARE_CLAIMS_EVIDENCE_TYPE, signal: 'denials-rising' },
  { rule: CLINICS_PNL_TREND, evidence: pnl, type: PNL_LINE_EVIDENCE_TYPE, signal: 'expense-outpacing-revenue' },
  { rule: CLINICS_LEASE_TERM, evidence: [], pages: lease, type: PREMISES_LEASE_EVIDENCE_TYPE, signal: 'short-term-no-renewal' },
];

describe('small clinics rule directions agree with the valuation direction map (T-161)', () => {
  it.each(CASES)('$rule.id → $type / $signal', ({ rule, evidence, pages, type, signal }) => {
    const proposals = rule.detect({ evidence, pages: pages ?? [] });
    expect(proposals.length, rule.id).toBeGreaterThan(0);
    const expected = defaultDirectionFor(type, signal);
    expect(expected, `${type}/${signal}`).not.toBeNull();
    for (const proposal of proposals) {
      expect(proposal.direction).toBe(expected);
      expect(proposal.direction).not.toBe(1);
    }
  });
});
