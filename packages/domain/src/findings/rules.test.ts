import { describe, expect, it } from 'vitest';
import { FindingRuleError, ruleProposals, type FindingRule, type RuleContext, type RuleProposal } from './rules';
import type { DocumentCitation } from './types';
import { createDraft, validateEvidenceLink } from './workflow';

const E1 = '01900000-0000-7000-8000-0000000c0001';
const E2 = '01900000-0000-7000-8000-0000000c0002';
const DOC = '01900000-0000-7000-8000-0000000c0009';
const context: RuleContext = {
  evidence: [
    { id: E1, evidenceType: 'test.row', sourceRecordId: 'r1', canonical: { value: '5' } },
    { id: E2, evidenceType: 'other.row', sourceRecordId: 'r2', canonical: { value: '9' } },
  ],
  pages: [{ documentId: DOC, pageNumber: 2, text: 'The Bank may terminate on a change of control.' }],
};
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
const rule = (detect: FindingRule['detect'], readsDocuments = false): FindingRule => ({ id: 'test-rule', version: '2', evidenceTypes: ['test.row'], readsDocuments, detect });
const ids = { id: '01900000-0000-7000-8000-0000000d0001', organizationId: '01900000-0000-7000-8000-0000000d0002', dealId: '01900000-0000-7000-8000-0000000d0003', now: '2026-10-23T00:00:00.000Z' };
const actor = { kind: 'SYSTEM', component: 'pack-rules' } as const;
const citation: DocumentCitation = { documentId: DOC, pageNumber: 2, quote: 'terminate on a change of control', quoteHash: 'a'.repeat(64), charStart: 13, charEnd: 45 };

describe('pack finding rules', () => {
  it('reads only its evidence types (and pages only when it asks), proposing cited drafts without a commit', () => {
    let seen: RuleContext = { evidence: [], pages: [] };
    const { proposals, unresolved } = ruleProposals(rule((input) => ((seen = input), [proposal()])), context);
    expect(seen.evidence.map((item) => item.id)).toEqual([E1]);
    expect(seen.pages).toEqual([]);
    expect(unresolved).toBe(0);
    expect(proposals[0]).toMatchObject({ origin: 'HEURISTIC', fingerprint: 'pack-rule:test-rule:2:r1', direction: 1 });
    expect(proposals[0]?.evidence).toEqual([
      { evidenceItemId: E1, documentCitation: null, commitSha: null, toolName: 'pack-rule:test-rule', toolVersion: '2', rulesetVersion: null, path: null, lineStart: null, lineEnd: null },
    ]);
    expect(createDraft(proposals[0]!, actor, ids)).toMatchObject({ status: 'DRAFT', domain: 'FINANCIAL' });
  });

  it('cites a page quote once verified; an unverified quote drops the proposal and is counted', () => {
    const quoting = rule(() => [proposal({ evidenceIds: [], quotes: [{ documentId: DOC, pageNumber: 2, quote: 'terminate on a change of control' }] })], true);
    const verified = ruleProposals(quoting, context, () => citation);
    expect(verified.proposals[0]?.evidence).toEqual([expect.objectContaining({ evidenceItemId: null, documentCitation: citation, commitSha: null })]);
    expect(createDraft(verified.proposals[0]!, actor, ids).status).toBe('DRAFT');
    expect(ruleProposals(quoting, context, () => null)).toEqual({ proposals: [], unresolved: 1 });
  });

  it('refuses proposals that break the rules of the core', () => {
    const fails = (bad: Partial<RuleProposal>, readsDocuments = false) => () => ruleProposals(rule(() => [proposal(bad)], readsDocuments), context, () => citation);
    expect(fails({ domain: 'SECURITY' as never })).toThrow(FindingRuleError);
    expect(fails({ evidenceIds: [] })).toThrow(/cite evidence/);
    expect(fails({ evidenceIds: [E2] })).toThrow(/not given/);
    expect(fails({ quotes: [{ documentId: DOC, pageNumber: 2, quote: 'x'.repeat(20) }] })).toThrow(/page it was not given/);
    expect(fails({ direction: 0, valueConfirmation: null, directionRationale: '  ' })).toThrow(/rationale/);
  });

  it('a link cites exactly one source; technology findings still need a commit; a path needs its commit', () => {
    const [base] = ruleProposals(rule(() => [proposal()]), context).proposals;
    const first = base!.evidence[0]!;
    expect(() => createDraft({ ...base!, domain: 'SECURITY' }, actor, ids)).toThrow(/commit hash/);
    expect(() => createDraft({ ...base!, evidence: [{ ...first, path: 'a.ts' }] }, actor, ids)).toThrow(/needs the commit/);
    expect(() => validateEvidenceLink({ ...first, documentCitation: citation })).toThrow(/either/);
    expect(() => validateEvidenceLink({ ...first, evidenceItemId: null })).toThrow(/either/);
    expect(() => validateEvidenceLink({ ...first, evidenceItemId: null, documentCitation: { ...citation, quoteHash: 'nope' } })).toThrow(/document citation/);
  });
});
