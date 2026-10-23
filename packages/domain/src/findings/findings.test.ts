import { describe, expect, it } from 'vitest';
import { newId } from '../ids';
import {
  analyseKeyPersonRisk,
  createDraft,
  decide,
  detectGhostCommits,
  editDraft,
  FindingValidationError,
  FindingWorkflowError,
  ghostCommitFinding,
  keyPersonFindings,
  MIN_CONTRIBUTOR_COHORT,
  scanFindingToProposal,
  healthyOwnershipFinding,
  validatePricedRisk,
  validateValueConfirmation,
  type CommitMetadata,
  type FindingActor,
  type ProposedFinding,
} from './index';

const SHA = 'a'.repeat(40);
const now = '2026-10-04T00:00:00.000Z';
const lead: FindingActor = { kind: 'HUMAN', userId: newId(), role: 'DEAL_LEAD' };
const reviewer: FindingActor = { kind: 'HUMAN', userId: newId(), role: 'REVIEWER' };
const analyst: FindingActor = { kind: 'HUMAN', userId: newId(), role: 'ANALYST' };
const ai: FindingActor = { kind: 'AI', promptVersion: 'tech-review@1' };

const link = () => ({
  evidenceItemId: newId(),
  documentCitation: null,
  commitSha: SHA,
  toolName: 'semgrep',
  toolVersion: '1.0.0-fixture',
  rulesetVersion: 'p/default@fixture',
  path: 'src/app.ts',
  lineStart: 3,
  lineEnd: 4,
});

const proposal = (overrides: Partial<ProposedFinding> = {}): ProposedFinding => ({
  domain: 'SECURITY',
  title: 'Hard-coded credential',
  description: 'Rule matched a credential literal.',
  severity: 'HIGH',
  confidence: 'HIGH',
  origin: 'SCANNER',
  fingerprint: 'scan:abc',
  evidence: [link()],
  pricedRisk: null,
  ...overrides,
});

const ctx = () => ({ id: newId(), organizationId: newId(), dealId: newId(), now });
const review = () => ({ reviewId: newId(), now });

describe('finding workflow', () => {
  it('always creates DRAFT, even when an AI proposes it', () => {
    const draft = createDraft(proposal(), ai, ctx());
    expect(draft).toMatchObject({ status: 'DRAFT', version: 1, createdBy: ai });
  });

  it('runs draft → in-review → accepted with an append-only human review', () => {
    const draft = createDraft(proposal(), analyst, ctx());
    const submitted = decide(draft, 'SUBMITTED', 'Ready for review', analyst, review());
    expect(submitted.finding.status).toBe('IN_REVIEW');
    const accepted = decide(
      submitted.finding,
      'ACCEPTED',
      'Verified at commit',
      reviewer,
      review(),
      { direction: 0, directionRationale: 'Rotated already; no exposure remains' },
    );
    expect(accepted.finding).toMatchObject({ status: 'ACCEPTED', version: 3 });
    expect(accepted.review).toMatchObject({
      decision: 'ACCEPTED',
      fromStatus: 'IN_REVIEW',
      toStatus: 'ACCEPTED',
      reviewerUserId: (reviewer as { userId: string }).userId,
      rationale: 'Verified at commit',
    });
    const resolved = accepted.finding.evidence[0]!;
    expect(resolved.commitSha).toBe(SHA);
    expect(resolved.toolVersion).toBe('1.0.0-fixture');
    expect(resolved.evidenceItemId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never lets AI or system actors move a finding past DRAFT', () => {
    const draft = createDraft(proposal(), ai, ctx());
    expect(() => decide(draft, 'SUBMITTED', 'x', ai, review())).toThrow(FindingWorkflowError);
    const inReview = decide(draft, 'SUBMITTED', 'x', lead, review()).finding;
    for (const actor of [ai, { kind: 'SYSTEM', component: 'scanner' } as const]) {
      expect(() => decide(inReview, 'ACCEPTED', 'auto', actor, review())).toThrow(
        expect.objectContaining({ code: 'HUMAN_REQUIRED' }),
      );
    }
  });

  it('only reviewers and deal leads decide; analysts cannot accept', () => {
    const inReview = decide(
      createDraft(proposal(), analyst, ctx()),
      'SUBMITTED',
      'x',
      analyst,
      review(),
    ).finding;
    expect(() => decide(inReview, 'ACCEPTED', 'ok', analyst, review())).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(decide(inReview, 'REJECTED', 'False positive', lead, review()).finding.status).toBe(
      'REJECTED',
    );
    const viewer: FindingActor = { kind: 'HUMAN', userId: newId(), role: 'VIEWER' };
    expect(() => createDraft(proposal(), viewer, ctx())).toThrow(FindingWorkflowError);
  });

  it('cannot accept without evidence or rationale, nor skip review', () => {
    const bare = createDraft(proposal({ evidence: [] }), analyst, ctx());
    expect(() => decide(bare, 'ACCEPTED', 'ok', reviewer, review())).toThrow(
      expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    );
    const inReview = decide(bare, 'SUBMITTED', 'x', analyst, review()).finding;
    expect(() => decide(inReview, 'ACCEPTED', 'ok', reviewer, review())).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_REQUIRED' }),
    );
    expect(() => decide(inReview, 'REJECTED', '   ', reviewer, review())).toThrow(
      expect.objectContaining({ code: 'RATIONALE_REQUIRED' }),
    );
    const back = decide(inReview, 'SUPPORT_REQUESTED', 'Attach evidence', reviewer, review());
    expect(back.finding.status).toBe('DRAFT');
  });

  it('edits drafts only and validates evidence links', () => {
    const draft = createDraft(proposal(), analyst, ctx());
    expect(editDraft(draft, { severity: 'LOW' }, analyst, now)).toMatchObject({
      severity: 'LOW',
      version: 2,
    });
    expect(() =>
      editDraft(draft, { evidence: [{ ...link(), commitSha: 'abc' }] }, analyst, now),
    ).toThrow(FindingValidationError);
    expect(() =>
      editDraft(draft, { evidence: [{ ...link(), path: '../etc/passwd' }] }, analyst, now),
    ).toThrow(FindingValidationError);
    const inReview = decide(draft, 'SUBMITTED', 'x', analyst, review()).finding;
    expect(() => editDraft(inReview, { severity: 'LOW' }, analyst, now)).toThrow(
      FindingWorkflowError,
    );
  });
});

describe('priced risk', () => {
  const risk = {
    type: 'ESCROW' as const,
    currency: 'USD',
    low: '250000',
    high: '750000.50',
    basis: 'Remediation estimate',
  };

  it('accepts ordered decimal-string ranges with currency', () => {
    expect(validatePricedRisk(risk)).toEqual(risk);
    expect(createDraft(proposal({ pricedRisk: risk }), analyst, ctx()).pricedRisk).toEqual(risk);
  });

  it('rejects floats, negatives, bad currency and inverted ranges', () => {
    expect(() => validatePricedRisk({ ...risk, low: 1.5 as unknown as string })).toThrow();
    expect(() => validatePricedRisk({ ...risk, low: '-1' })).toThrow();
    expect(() => validatePricedRisk({ ...risk, currency: 'usd' })).toThrow();
    expect(() => validatePricedRisk({ ...risk, low: '750000.51' })).toThrow();
    expect(() => validatePricedRisk({ ...risk, basis: ' ' })).toThrow();
  });
});

function commit(
  index: number,
  author: string,
  path = 'app/main.ts',
  authoredAt = '2026-06-01T00:00:00Z',
): CommitMetadata {
  return {
    sha: index.toString(16).padStart(40, '0'),
    authorIdentity: author,
    authoredAt,
    committedAt: authoredAt,
    additions: 1,
    deletions: 0,
    paths: [path],
  };
}

describe('ghost-commit signal', () => {
  const identities = [
    { identity: 'dev-1', status: 'CURRENT' as const, departedOn: null },
    { identity: 'dev-2', status: 'DEPARTED' as const, departedOn: '2026-03-31' },
  ];

  it('counts unmatched identities and commits after departure, exposing hashes only', () => {
    const commits = [
      commit(1, 'dev-1'),
      commit(2, 'dev-2', 'app/x.ts', '2026-02-01T00:00:00Z'),
      commit(3, 'dev-2'),
      commit(4, 'ghost-9'),
    ];
    const signal = detectGhostCommits(commits, identities);
    expect(signal).toMatchObject({
      commitsAnalysed: 4,
      ghostCommits: 2,
      unmatchedIdentityCommits: 1,
      departedIdentityCommits: 1,
      shareBasisPoints: 5000,
    });
    expect(signal.sampleCommitShas).toEqual([commits[2]!.sha, commits[3]!.sha]);
    const draft = ghostCommitFinding(signal, { evidenceItemId: newId(), headCommitSha: SHA });
    expect(draft).toMatchObject({
      domain: 'CODE_PROVENANCE',
      severity: 'HIGH',
      origin: 'HEURISTIC',
    });
    expect(JSON.stringify(draft)).not.toContain('ghost-9');
    expect(JSON.stringify(draft)).not.toContain('dev-2');
  });

  it('proposes nothing when every commit is attributed', () => {
    const signal = detectGhostCommits([commit(1, 'dev-1')], identities);
    expect(ghostCommitFinding(signal, { evidenceItemId: newId(), headCommitSha: SHA })).toBeNull();
  });
});

describe('key-person signal', () => {
  it('suppresses cohorts smaller than the minimum', () => {
    const commits = Array.from({ length: MIN_CONTRIBUTOR_COHORT - 1 }, (_, i) =>
      commit(i, `dev-${i}`),
    );
    expect(analyseKeyPersonRisk(commits)).toEqual({ suppressed: true, reason: 'SMALL_COHORT' });
    expect(
      keyPersonFindings(analyseKeyPersonRisk(commits), {
        evidenceItemId: newId(),
        headCommitSha: SHA,
      }),
    ).toEqual([]);
  });

  it('reports bus factor and single-owner subsystems without naming anyone', () => {
    const commits = [
      ...Array.from({ length: 12 }, (_, i) => commit(i, 'owner-1', 'billing/ledger.ts')),
      ...Array.from({ length: 10 }, (_, i) => commit(100 + i, `dev-${i % 5}`, 'web/page.ts')),
    ];
    const signal = analyseKeyPersonRisk(commits);
    expect(signal).toMatchObject({ suppressed: false, contributors: 6, busFactor: 1 });
    if (signal.suppressed) throw new Error('unexpected');
    expect(signal.concentratedSubsystems).toEqual([
      { subsystem: 'billing', commits: 12, topContributorShareBasisPoints: 10_000 },
    ]);
    const drafts = keyPersonFindings(signal, { evidenceItemId: newId(), headCommitSha: SHA });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ domain: 'KEY_PERSON', severity: 'HIGH' });
    expect(JSON.stringify(drafts)).not.toContain('owner-1');
  });
});

describe('scan findings', () => {
  it('maps a license result to an OSS draft resolving to commit, tool version and evidence', () => {
    const evidenceItemId = newId();
    const draft = scanFindingToProposal(
      {
        category: 'LICENSE',
        ruleId: 'copyleft-in-distributed-code',
        title: 'AGPL-3.0 dependency in distributed product',
        severity: 'HIGH',
        confidence: 'HIGH',
        path: 'package.json',
        lineStart: null,
        lineEnd: null,
        fingerprint: 'f'.repeat(64),
        scanner: 'cyclonedx-sbom',
        scannerVersion: '1.6-fixture',
        rulesetVersion: 'license-policy@1',
        commitSha: SHA,
        remediation: 'Replace or obtain a commercial license.',
        license: 'AGPL-3.0-only',
        component: 'pkg:npm/fixture-agpl-lib@2.1.0',
        cve: null,
      },
      evidenceItemId,
    );
    expect(draft.domain).toBe('OSS_LICENSE');
    expect(draft.evidence[0]).toMatchObject({
      evidenceItemId,
      commitSha: SHA,
      toolVersion: '1.6-fixture',
    });
    expect(createDraft(draft, ai, ctx()).status).toBe('DRAFT');
  });
});

describe('valuation direction', () => {
  const PRICE = { type: 'REMEDIATION_COST' as const, currency: 'USD', low: '10000', high: '25000', basis: 'Synthetic estimate' };
  const CONFIRMS = { valueDriver: 'ARR quality', impliedValue: { low: '0', high: '50000', currency: 'USD' }, basis: 'Reconciled ARR above the CIM' };
  const inReview = (overrides: Partial<ProposedFinding> = {}) =>
    decide(createDraft(proposal(overrides), analyst, ctx()), 'SUBMITTED', 'Ready', analyst, review()).finding;
  const accept = (finding: ReturnType<typeof inReview>, choice = {}) => decide(finding, 'ACCEPTED', 'Checked', reviewer, review(), choice);

  it('keeps money on one side: price on drags, confirmations on cushions, nothing on neutral', () => {
    expect(() => createDraft(proposal({ direction: 1, pricedRisk: PRICE }), analyst, ctx())).toThrow(FindingValidationError);
    expect(() => createDraft(proposal({ direction: 0, pricedRisk: PRICE }), analyst, ctx())).toThrow(FindingValidationError);
    expect(() => createDraft(proposal({ direction: -1, valueConfirmation: CONFIRMS }), analyst, ctx())).toThrow(FindingValidationError);
    expect(() => createDraft(proposal({ direction: 2 as never }), analyst, ctx())).toThrow(FindingValidationError);
    expect(createDraft(proposal({ pricedRisk: PRICE }), analyst, ctx())).toMatchObject({ direction: null, pricedRisk: PRICE });
  });

  it('validates what a cushion confirms', () => {
    expect(validateValueConfirmation({ ...CONFIRMS, impliedValue: null }).impliedValue).toBeNull();
    expect(() => validateValueConfirmation({ ...CONFIRMS, valueDriver: ' ' })).toThrow(FindingValidationError);
    expect(() => validateValueConfirmation({ ...CONFIRMS, basis: '' })).toThrow(FindingValidationError);
    expect(() => validateValueConfirmation({ ...CONFIRMS, impliedValue: { low: '9', high: '1', currency: 'USD' } })).toThrow(FindingValidationError);
    expect(() => validateValueConfirmation({ ...CONFIRMS, impliedValue: { low: '-1', high: '1', currency: 'USD' } })).toThrow(FindingValidationError);
  });

  it('needs a decided direction to accept, and records it on the review', () => {
    expect(() => accept(inReview())).toThrow(expect.objectContaining({ code: 'DIRECTION_REQUIRED' }));
    const accepted = accept(inReview({ direction: -1, pricedRisk: PRICE }));
    expect(accepted.finding.direction).toBe(-1);
    expect(accepted.review).toMatchObject({ direction: -1, directionRationale: null });
  });

  it('never accepts an unpriced drag, an unexplained cushion or an unexplained neutral', () => {
    expect(() => accept(inReview({ direction: -1 }))).toThrow(expect.objectContaining({ code: 'DRAG_NEEDS_PRICE' }));
    expect(() => accept(inReview({ direction: 1 }))).toThrow(expect.objectContaining({ code: 'CUSHION_NEEDS_DRIVER' }));
    expect(() => accept(inReview({ direction: 0 }))).toThrow(expect.objectContaining({ code: 'NEUTRAL_NEEDS_RATIONALE' }));
    expect(accept(inReview({ direction: 1, valueConfirmation: CONFIRMS })).finding).toMatchObject({ direction: 1, valueConfirmation: CONFIRMS });
    expect(accept(inReview({ direction: 0, directionRationale: 'Informational only' })).finding.direction).toBe(0);
  });

  it('lets the reviewer override the proposal only with a reason, and only into a valid shape', () => {
    const proposedDrag = inReview({ direction: -1 });
    expect(() => accept(proposedDrag, { direction: 0 })).toThrow(expect.objectContaining({ code: 'RATIONALE_REQUIRED' }));
    const overridden = accept(proposedDrag, { direction: 0, directionRationale: 'Commits are from a renamed account, verified' });
    expect(overridden.finding).toMatchObject({ direction: 0, directionRationale: 'Commits are from a renamed account, verified' });
    expect(overridden.review).toMatchObject({ direction: 0, directionRationale: 'Commits are from a renamed account, verified' });
    // A priced drag cannot be turned into a cushion without removing its price.
    expect(() => accept(inReview({ direction: -1, pricedRisk: PRICE }), { direction: 1, directionRationale: 'x y z' })).toThrow(FindingWorkflowError);
  });

  it('heuristics propose drags unpriced, and healthy ownership proposes a cushion', () => {
    const commits = Array.from({ length: 40 }, (_, index) => ({
      sha: SHA,
      authorIdentity: `dev-${index % 8}`,
      authoredAt: now,
      committedAt: now,
      additions: 1,
      deletions: 0,
      paths: [`module-${index % 4}/file.ts`],
    }));
    const signal = analyseKeyPersonRisk(commits);
    const cushion = healthyOwnershipFinding(signal, { evidenceItemId: newId(), headCommitSha: SHA });
    expect(cushion).toMatchObject({ direction: 1, pricedRisk: null, valueConfirmation: { valueDriver: 'Engineering continuity', impliedValue: null } });
    const ghost = ghostCommitFinding(detectGhostCommits([{ ...commits[0]!, authorIdentity: 'unknown' }], []), { evidenceItemId: newId(), headCommitSha: SHA });
    expect(ghost).toMatchObject({ direction: -1, pricedRisk: null });
  });
});
