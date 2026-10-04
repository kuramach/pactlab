import type { FindingSeverity, ProposedFinding } from './types';

/**
 * Commit metadata as read from a repository provider. Identities are provider
 * account ids, never display names; no file contents or diffs are carried.
 */
export interface CommitMetadata {
  readonly sha: string;
  readonly authorIdentity: string;
  readonly authoredAt: string;
  readonly committedAt: string;
  readonly additions: number;
  readonly deletions: number;
  /** Repository-relative paths touched. */
  readonly paths: readonly string[];
}

/**
 * Identity-map entry supplied with the repository connection. Only the
 * matched/departed status is used, and only to produce aggregate counts.
 */
export interface ContributorIdentity {
  readonly identity: string;
  readonly status: 'CURRENT' | 'DEPARTED';
  /** ISO date; commits authored after it are attributed to a departed identity. */
  readonly departedOn: string | null;
}

export const GHOST_COMMIT_TOOL = { name: 'pactlab-ghost-commit', version: '1.0.0' } as const;
export const KEY_PERSON_TOOL = { name: 'pactlab-key-person', version: '1.0.0' } as const;

/** Smallest contributor cohort for which concentration aggregates are reported. */
export const MIN_CONTRIBUTOR_COHORT = 5;

const SAMPLE_LIMIT = 10;

/** Integer basis points; no floating point in signal values. */
function basisPoints(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.floor((part * 10_000) / whole);
}

export interface GhostCommitSignal {
  readonly commitsAnalysed: number;
  readonly ghostCommits: number;
  readonly unmatchedIdentityCommits: number;
  readonly departedIdentityCommits: number;
  readonly shareBasisPoints: number;
  /** Commit hashes only — the evidence a reviewer opens. */
  readonly sampleCommitShas: readonly string[];
}

/**
 * Ghost commits: commits attributed to identities missing from the identity
 * map, or authored after an identity's departure date.
 */
export function detectGhostCommits(
  commits: readonly CommitMetadata[],
  identities: readonly ContributorIdentity[],
): GhostCommitSignal {
  const byIdentity = new Map(identities.map((entry) => [entry.identity, entry]));
  let unmatched = 0;
  let departed = 0;
  const samples: string[] = [];
  for (const commit of commits) {
    const known = byIdentity.get(commit.authorIdentity);
    const ghost = !known
      ? 'unmatched'
      : known.status === 'DEPARTED' &&
          known.departedOn !== null &&
          commit.authoredAt.slice(0, 10) > known.departedOn
        ? 'departed'
        : null;
    if (ghost === 'unmatched') unmatched += 1;
    if (ghost === 'departed') departed += 1;
    if (ghost && samples.length < SAMPLE_LIMIT) samples.push(commit.sha);
  }
  const ghostCommits = unmatched + departed;
  return {
    commitsAnalysed: commits.length,
    ghostCommits,
    unmatchedIdentityCommits: unmatched,
    departedIdentityCommits: departed,
    shareBasisPoints: basisPoints(ghostCommits, commits.length),
    sampleCommitShas: samples,
  };
}

function ghostSeverity(shareBasisPoints: number): FindingSeverity {
  if (shareBasisPoints >= 1_000) return 'HIGH';
  if (shareBasisPoints >= 200) return 'MEDIUM';
  return 'LOW';
}

function percent(bp: number): string {
  return `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, '0')}%`;
}

/** Draft finding for a ghost-commit signal, or null when there is nothing to review. */
export function ghostCommitFinding(
  signal: GhostCommitSignal,
  source: { evidenceItemId: string; headCommitSha: string },
): ProposedFinding | null {
  if (signal.ghostCommits === 0) return null;
  return {
    domain: 'CODE_PROVENANCE',
    title: `${signal.ghostCommits} commits attributed to unmatched or departed identities`,
    description:
      `${signal.ghostCommits} of ${signal.commitsAnalysed} commits (${percent(signal.shareBasisPoints)}) ` +
      `were authored by identities missing from the identity map (${signal.unmatchedIdentityCommits}) ` +
      `or after a recorded departure (${signal.departedIdentityCommits}). ` +
      `Sample commits: ${signal.sampleCommitShas.map((sha) => sha.slice(0, 12)).join(', ')}.`,
    severity: ghostSeverity(signal.shareBasisPoints),
    confidence: 'MEDIUM',
    origin: 'HEURISTIC',
    fingerprint: `ghost-commit:${source.headCommitSha}`,
    evidence: [
      {
        evidenceItemId: source.evidenceItemId,
        commitSha: source.headCommitSha,
        toolName: GHOST_COMMIT_TOOL.name,
        toolVersion: GHOST_COMMIT_TOOL.version,
        rulesetVersion: null,
        path: null,
        lineStart: null,
        lineEnd: null,
      },
    ],
    pricedRisk: null,
  };
}

export interface SubsystemConcentration {
  readonly subsystem: string;
  readonly commits: number;
  readonly topContributorShareBasisPoints: number;
}

/** Aggregate-only contribution concentration. Never names a contributor. */
export type KeyPersonSignal =
  | { readonly suppressed: true; readonly reason: 'SMALL_COHORT' }
  | {
      readonly suppressed: false;
      readonly contributors: number;
      readonly commitsAnalysed: number;
      /** Fewest contributors who together authored more than half of all commits. */
      readonly busFactor: number;
      readonly topContributorShareBasisPoints: number;
      readonly concentratedSubsystems: readonly SubsystemConcentration[];
    };

const SUBSYSTEM_MIN_COMMITS = 10;
const SUBSYSTEM_CONCENTRATION_BP = 8_000;

function topShare(counts: ReadonlyMap<string, number>, total: number): number {
  return basisPoints(Math.max(0, ...counts.values()), total);
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * Key-person signal from commit metadata. Subsystems are top-level paths.
 * Cohorts smaller than MIN_CONTRIBUTOR_COHORT are suppressed entirely.
 */
export function analyseKeyPersonRisk(commits: readonly CommitMetadata[]): KeyPersonSignal {
  const perIdentity = new Map<string, number>();
  const perSubsystem = new Map<string, Map<string, number>>();
  for (const commit of commits) {
    increment(perIdentity, commit.authorIdentity);
    const subsystems = new Set(commit.paths.map((path) => path.split('/')[0] ?? path));
    for (const subsystem of subsystems) {
      const owners = perSubsystem.get(subsystem) ?? new Map<string, number>();
      increment(owners, commit.authorIdentity);
      perSubsystem.set(subsystem, owners);
    }
  }
  if (perIdentity.size < MIN_CONTRIBUTOR_COHORT)
    return { suppressed: true, reason: 'SMALL_COHORT' };

  const sorted = [...perIdentity.values()].sort((a, b) => b - a);
  let covered = 0;
  let busFactor = 0;
  for (const count of sorted) {
    covered += count;
    busFactor += 1;
    if (covered * 2 > commits.length) break;
  }
  const concentratedSubsystems = [...perSubsystem.entries()]
    .map(([subsystem, owners]) => {
      const total = [...owners.values()].reduce((sum, count) => sum + count, 0);
      return {
        subsystem,
        commits: total,
        topContributorShareBasisPoints: topShare(owners, total),
      };
    })
    .filter(
      (entry) =>
        entry.commits >= SUBSYSTEM_MIN_COMMITS &&
        entry.topContributorShareBasisPoints >= SUBSYSTEM_CONCENTRATION_BP,
    )
    .sort((a, b) => a.subsystem.localeCompare(b.subsystem));
  return {
    suppressed: false,
    contributors: perIdentity.size,
    commitsAnalysed: commits.length,
    busFactor,
    topContributorShareBasisPoints: topShare(perIdentity, commits.length),
    concentratedSubsystems,
  };
}

/** One draft per concentrated subsystem. Descriptions carry aggregates only. */
export function keyPersonFindings(
  signal: KeyPersonSignal,
  source: { evidenceItemId: string; headCommitSha: string },
): ProposedFinding[] {
  if (signal.suppressed) return [];
  return signal.concentratedSubsystems.map((entry) => ({
    domain: 'KEY_PERSON',
    title: `Single-contributor concentration in ${entry.subsystem}/`,
    description:
      `One contributor authored ${percent(entry.topContributorShareBasisPoints)} of ${entry.commits} ` +
      `commits touching ${entry.subsystem}/. Repository bus factor is ${signal.busFactor} ` +
      `across ${signal.contributors} contributors. Aggregate signal only; identify and assess ` +
      `retention through the consent-gated people workflow.`,
    severity: signal.busFactor <= 1 ? 'HIGH' : 'MEDIUM',
    confidence: 'MEDIUM',
    origin: 'HEURISTIC',
    fingerprint: `key-person:${source.headCommitSha}:${entry.subsystem}`,
    evidence: [
      {
        evidenceItemId: source.evidenceItemId,
        commitSha: source.headCommitSha,
        toolName: KEY_PERSON_TOOL.name,
        toolVersion: KEY_PERSON_TOOL.version,
        rulesetVersion: null,
        path: entry.subsystem,
        lineStart: null,
        lineEnd: null,
      },
    ],
    pricedRisk: null,
  }));
}
