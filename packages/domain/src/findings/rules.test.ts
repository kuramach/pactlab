import { describe, expect, it } from 'vitest';
import { FindingRuleError, ruleProposals, type FindingRule, type RuleProposal } from './rules';
import { createDraft } from './workflow';

const E1 = '01900000-0000-7000-8000-0000000c0001';
const E2 = '01900000-0000-7000-8000-0000000c0002';
const evidence = [
  { id: E1, evidenceType: 'test.row', sourceRecordId: 'r1', canonical: { value: '5' } },
  { id: E2, evidenceType: 'other.row', sourceRecordId: 'r2', canonical: { value: '9' } },
];
const proposal = (overrides: Partial<RuleProposal> = {}): RuleProposal => ({
  key: 'r1',
  domain: 'FINANCIAL',
  title: 'Row r1 stands out',
  description: 'Test.',
  severity: 'MEDIUM',
  confidence: 'HIGH',
  direction: 1,
  valueConfirmation: { valueDriver: 'Below-market rents', impliedValue: null, basis: 'Test basis' },
  evidenceIds: [E1],
  ...overrides,
});
const rule = (detect: FindingRule['detect']): FindingRule => ({ id: 'test-rule', version: '2', evidenceTypes: ['test.row'], detect });

describe('pack finding rules', () => {
  it('reads only its evidence types and proposes cited drafts without a commit', () => {
    let seen: string[] = [];
    const proposals = ruleProposals(rule((input) => ((seen = input.map((item) => item.id)), [proposal()])), evidence);
    expect(seen).toEqual([E1]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ origin: 'HEURISTIC', fingerprint: 'pack-rule:test-rule:2:r1', direction: 1 });
    expect(proposals[0]?.evidence).toEqual([
      { evidenceItemId: E1, commitSha: null, toolName: 'pack-rule:test-rule', toolVersion: '2', rulesetVersion: null, path: null, lineStart: null, lineEnd: null },
    ]);
    const draft = createDraft(proposals[0]!, { kind: 'SYSTEM', component: 'pack-rules' }, { id: '01900000-0000-7000-8000-0000000d0001', organizationId: '01900000-0000-7000-8000-0000000d0002', dealId: '01900000-0000-7000-8000-0000000d0003', now: '2026-10-23T00:00:00.000Z' });
    expect(draft).toMatchObject({ status: 'DRAFT', domain: 'FINANCIAL' });
  });

  it('refuses proposals that break the rules of the core', () => {
    const fails = (bad: Partial<RuleProposal>) => () => ruleProposals(rule(() => [proposal(bad)]), evidence);
    expect(fails({ domain: 'SECURITY' as never })).toThrow(FindingRuleError);
    expect(fails({ evidenceIds: [] })).toThrow(/cite evidence/);
    expect(fails({ evidenceIds: [E2] })).toThrow(/not given/);
    expect(fails({ direction: 0, valueConfirmation: null, directionRationale: '  ' })).toThrow(/rationale/);
  });

  it('technology findings still need a commit; a path needs its commit', () => {
    const [base] = ruleProposals(rule(() => [proposal()]), evidence);
    const ids = { id: '01900000-0000-7000-8000-0000000d0001', organizationId: '01900000-0000-7000-8000-0000000d0002', dealId: '01900000-0000-7000-8000-0000000d0003', now: '2026-10-23T00:00:00.000Z' };
    const actor = { kind: 'SYSTEM', component: 'pack-rules' } as const;
    expect(() => createDraft({ ...base!, domain: 'SECURITY' }, actor, ids)).toThrow(/commit hash/);
    expect(() => createDraft({ ...base!, evidence: [{ ...base!.evidence[0]!, path: 'a.ts' }] }, actor, ids)).toThrow(/needs the commit/);
  });
});
