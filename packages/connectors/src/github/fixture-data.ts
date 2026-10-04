import { createHash } from 'node:crypto';
import type { CommitMetadata, ContributorIdentity } from '@pactlab/domain';

/**
 * Deterministic synthetic repositories. Identities are stable pseudonymous
 * account ids shared with the cross-system identity map; no real people,
 * no source contents. Generated, not recorded, so they never drift.
 */
export interface GitHubFixtureRepository {
  readonly repository: string;
  readonly defaultBranch: string;
  readonly grantedPermissions: readonly string[];
  readonly commits: readonly CommitMetadata[];
  readonly identityMap: readonly ContributorIdentity[];
}

interface CommitPlan {
  readonly author: string;
  readonly path: string;
  readonly count: number;
  readonly from: string;
}

function sha(seed: string): string {
  return createHash('sha1').update(seed).digest('hex');
}

function plannedCommits(repository: string, plans: readonly CommitPlan[]): CommitMetadata[] {
  const commits: CommitMetadata[] = [];
  for (const plan of plans) {
    const start = Date.parse(plan.from);
    for (let i = 0; i < plan.count; i += 1) {
      const at = new Date(start + i * 86_400_000).toISOString();
      commits.push({
        sha: sha(`${repository}:${plan.author}:${plan.path}:${i}`),
        authorIdentity: plan.author,
        authoredAt: at,
        committedAt: at,
        additions: 10 + ((i * 7) % 40),
        deletions: (i * 3) % 15,
        paths: plan.path ? [`${plan.path}/file-${i % 4}.ts`] : [],
      });
    }
  }
  // Newest first, as repository providers list history.
  return commits.sort(
    (a, b) => b.authoredAt.localeCompare(a.authoredAt) || a.sha.localeCompare(b.sha),
  );
}

function current(...ids: string[]): ContributorIdentity[] {
  return ids.map((identity) => ({ identity, status: 'CURRENT', departedOn: null }));
}

const HEALTHY_DEVS = ['hc-dev-01', 'hc-dev-02', 'hc-dev-03', 'hc-dev-04', 'hc-dev-05', 'hc-dev-06'];
const SUBSYSTEMS = ['api', 'web', 'billing', 'infra'];

export const GITHUB_FIXTURES: Readonly<Record<string, GitHubFixtureRepository>> = {
  'healthyco/platform': {
    repository: 'healthyco/platform',
    defaultBranch: 'main',
    grantedPermissions: ['metadata:read', 'contents:read'],
    commits: plannedCommits(
      'healthyco/platform',
      HEALTHY_DEVS.flatMap((author, a) =>
        SUBSYSTEMS.map((path, s) => ({
          author,
          path,
          count: 5,
          from: `2026-0${1 + ((a + s) % 8)}-01T10:00:00Z`,
        })),
      ),
    ),
    identityMap: current(...HEALTHY_DEVS),
  },
  // Departed and unmatched identities produce ghost commits; tc-dev-01 alone
  // maintains billing/. Signals are deterministic for the acceptance journey.
  'troubledco/core': {
    repository: 'troubledco/core',
    defaultBranch: 'main',
    grantedPermissions: ['metadata:read', 'contents:read'],
    commits: plannedCommits('troubledco/core', [
      { author: 'tc-dev-01', path: 'billing', count: 30, from: '2026-01-05T09:00:00Z' },
      { author: 'tc-dev-02', path: 'billing', count: 1, from: '2026-02-10T09:00:00Z' },
      { author: 'tc-dev-02', path: 'web', count: 12, from: '2026-02-01T09:00:00Z' },
      { author: 'tc-dev-03', path: 'web', count: 10, from: '2026-03-01T09:00:00Z' },
      { author: 'tc-dev-04', path: 'api', count: 10, from: '2026-03-01T09:00:00Z' },
      { author: 'tc-dev-05', path: 'api', count: 6, from: '2025-11-01T09:00:00Z' },
      { author: 'tc-dev-05', path: 'api', count: 4, from: '2026-05-01T09:00:00Z' },
      { author: 'tc-contractor-x', path: 'api', count: 7, from: '2026-04-01T09:00:00Z' },
    ]),
    identityMap: [
      ...current('tc-dev-01', 'tc-dev-02', 'tc-dev-03', 'tc-dev-04'),
      { identity: 'tc-dev-05', status: 'DEPARTED', departedOn: '2026-01-31' },
    ],
  },
  // Small cohort (suppressed aggregates), stale history, commits without
  // paths, look-alike identities, and an installation missing contents:read.
  'sparseco/app': {
    repository: 'sparseco/app',
    defaultBranch: 'master',
    grantedPermissions: ['metadata:read'],
    commits: plannedCommits('sparseco/app', [
      { author: 'sc-dev-01', path: 'app', count: 40, from: '2024-03-01T09:00:00Z' },
      { author: 'sc-dev-1', path: '', count: 15, from: '2024-05-01T09:00:00Z' },
      { author: 'sc-dev-02', path: 'app', count: 8, from: '2024-06-01T09:00:00Z' },
    ]),
    identityMap: current('sc-dev-01', 'sc-dev-1', 'sc-dev-02'),
  },
};
