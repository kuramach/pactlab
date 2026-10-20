import { analyseKeyPersonRisk, ghostCommitFinding, healthyOwnershipFinding, keyPersonFindings, scanFindingToProposal, VALUATION_DIRECTIONS } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import { ADAPTER_EVIDENCE_TYPES, defaultDirectionFor, REPOSITORY_HEAD_EVIDENCE_TYPE, VALUATION_DIRECTION_MAP } from '.';

const SHA = 'b'.repeat(40);
const EVIDENCE = '0190f000-0000-7000-8000-0000000000e1';
const source = { evidenceItemId: EVIDENCE, headCommitSha: SHA };

describe('valuation direction map', () => {
  it('maps every evidence type an adapter emits', () => {
    for (const type of ADAPTER_EVIDENCE_TYPES) expect(VALUATION_DIRECTION_MAP[type]?.length ?? 0, type).toBeGreaterThan(0);
  });

  it('uses only -1, 0 and 1, and gives every neutral rule a rationale', () => {
    for (const [type, rules] of Object.entries(VALUATION_DIRECTION_MAP)) {
      for (const rule of rules) {
        expect((VALUATION_DIRECTIONS as readonly number[]).includes(rule.defaultDirection), `${type}/${rule.signal}`).toBe(true);
        if (rule.defaultDirection === 0) expect(rule.rationale?.trim().length ?? 0, `${type}/${rule.signal}`).toBeGreaterThan(10);
        if (rule.defaultDirection === 1) expect(rule.channel).toBe('CONFIRMATION');
        if (rule.defaultDirection === -1) expect(['PRICED_TERM', 'ASSUMPTION']).toContain(rule.channel);
      }
    }
  });

  it('agrees with the directions the domain heuristics propose', () => {
    const commits = Array.from({ length: 40 }, (_, index) => ({
      sha: SHA,
      authorIdentity: `dev-${index % 8}`,
      authoredAt: '2026-10-01T00:00:00Z',
      committedAt: '2026-10-01T00:00:00Z',
      additions: 1,
      deletions: 0,
      paths: [`module-${index % 4}/a.ts`],
    }));
    const healthy = healthyOwnershipFinding(analyseKeyPersonRisk(commits), source);
    expect(healthy?.direction).toBe(defaultDirectionFor(REPOSITORY_HEAD_EVIDENCE_TYPE, 'healthy-ownership'));

    const concentrated = commits.map((commit) => ({ ...commit, authorIdentity: 'dev-0', paths: ['core/a.ts'] }));
    const keyPerson = keyPersonFindings(analyseKeyPersonRisk([...concentrated, ...commits]), source);
    expect(keyPerson[0]?.direction).toBe(defaultDirectionFor(REPOSITORY_HEAD_EVIDENCE_TYPE, 'key-person'));

    const ghost = ghostCommitFinding(
      { commitsAnalysed: 1, ghostCommits: 1, unmatchedIdentityCommits: 1, departedIdentityCommits: 0, shareBasisPoints: 10_000, sampleCommitShas: [SHA] },
      source,
    );
    expect(ghost?.direction).toBe(defaultDirectionFor(REPOSITORY_HEAD_EVIDENCE_TYPE, 'ghost-commit'));

    const scan = scanFindingToProposal(
      {
        scanner: 'semgrep',
        scannerVersion: '1.0.0',
        rulesetVersion: null,
        ruleId: 'r1',
        category: 'CODE',
        title: 'Synthetic finding',
        severity: 'HIGH',
        confidence: 'HIGH',
        commitSha: SHA,
        path: 'src/a.ts',
        lineStart: 1,
        lineEnd: 1,
        component: null,
        license: null,
        cve: null,
        remediation: null,
        fingerprint: 'f1',
      } as Parameters<typeof scanFindingToProposal>[0],
      EVIDENCE,
    );
    expect(scan.direction).toBe(defaultDirectionFor(REPOSITORY_HEAD_EVIDENCE_TYPE, 'scan'));
  });
});
