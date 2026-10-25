import { createHash } from 'node:crypto';
import type { CommitMetadata, ContributorIdentity } from '@pactlab/domain';
import type { CheckSummary, PullRequestMetadata, ReviewSummary } from './types';

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
  /** Newest first, like the provider. */
  readonly pullRequests: readonly PullRequestMetadata[];
  readonly reviews: Readonly<Record<number, ReviewSummary>>;
  readonly checks: Readonly<Record<string, CheckSummary>>;
}

/** Which Jira keys commit messages cite: `${project}-1` … `${project}-${issues}`, plus keys that resolve to nothing. */
interface MessagePlan {
  readonly project: string | null;
  readonly issues: number;
  /** Cite a key on every n-th commit (1 = every commit). */
  readonly every: number;
  /** Authors whose commits cite keys that do not exist (unmatched links). */
  readonly unmatchedAuthors?: readonly string[];
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

function plannedCommits(repository: string, plans: readonly CommitPlan[], messages: MessagePlan): CommitMetadata[] {
  const commits: CommitMetadata[] = [];
  let seq = 0;
  for (const plan of plans) {
    const start = Date.parse(plan.from);
    for (let i = 0; i < plan.count; i += 1) {
      const at = new Date(start + i * 86_400_000).toISOString();
      seq += 1;
      const area = plan.path || 'repository';
      const key = !messages.project
        ? null
        : messages.unmatchedAuthors?.includes(plan.author)
          ? `${messages.project}-${900 + (seq % 50)}`
          : seq % messages.every === 0
            ? `${messages.project}-${1 + (seq % messages.issues)}`
            : null;
      commits.push({
        message: key ? `${key}: update ${area} (synthetic)` : `Update ${area} (synthetic)`,
        sha: sha(`${repository}:${plan.author}:${plan.path}:${i}`),
        authorIdentity: plan.author,
        authorName: FIXTURE_NAMES[plan.author] ?? null,
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

/** Synthetic display names, shared with the Jira fixtures; invented people only. */
export const FIXTURE_NAMES: Readonly<Record<string, string>> = {
  'hc-dev-01': 'Avery Lin (synthetic)',
  'hc-dev-02': 'Bianca Osei (synthetic)',
  'hc-dev-03': 'Carlos Mendes (synthetic)',
  'hc-dev-04': 'Dana Kowalski (synthetic)',
  'hc-dev-05': 'Elif Demir (synthetic)',
  'hc-dev-06': 'Farid Haddad (synthetic)',
  'hc-lead-01': 'Grace Okafor (synthetic)',
  'hc-pm-01': 'Hiro Tanaka (synthetic)',
  'tc-dev-01': 'Ivan Petrov (synthetic)',
  'tc-dev-02': 'Jade Moreau (synthetic)',
  'tc-dev-03': 'Kofi Mensah (synthetic)',
  'tc-dev-04': 'Lena Fischer (synthetic)',
  'tc-dev-05': 'Marco Rossi (synthetic)',
  'tc-lead-01': 'Nadia Rahman (synthetic)',
  'tc-contractor-x': 'Unmatched contractor (synthetic)',
};

function current(...ids: string[]): ContributorIdentity[] {
  return ids.map((identity) => ({ identity, status: 'CURRENT', departedOn: null }));
}

const HEALTHY_DEVS = ['hc-dev-01', 'hc-dev-02', 'hc-dev-03', 'hc-dev-04', 'hc-dev-05', 'hc-dev-06'];
const SUBSYSTEMS = ['api', 'web', 'billing', 'infra'];
const ALL_PERMISSIONS = ['metadata:read', 'contents:read', 'pull_requests:read', 'checks:read'];

interface PullPlan {
  /** Commits per pull request. */
  readonly size: number;
  /** The newest this many pull requests are still open. */
  readonly open: number;
  /** Reviewer for a pull request's author, or null to merge without review. */
  readonly reviewer: (author: string, index: number) => string | null;
  /** Whether the pull request's checks failed. */
  readonly failing: (index: number) => boolean;
}

/**
 * Pull requests grouped from the commit history (oldest first, `size`
 * commits each, one author per group), with reviews and check runs. Titles
 * reuse the first commit's message, so they cite the same issue keys.
 */
function plannedPulls(commits: readonly CommitMetadata[], plan: PullPlan) {
  const byAuthor = new Map<string, CommitMetadata[]>();
  for (const commit of [...commits].reverse()) byAuthor.set(commit.authorIdentity, [...(byAuthor.get(commit.authorIdentity) ?? []), commit]);
  const groups = [...byAuthor.values()].flatMap((list) => Array.from({ length: Math.ceil(list.length / plan.size) }, (_, i) => list.slice(i * plan.size, (i + 1) * plan.size)));
  groups.sort((a, b) => (a[0]?.authoredAt ?? '').localeCompare(b[0]?.authoredAt ?? '') || (a[0]?.sha ?? '').localeCompare(b[0]?.sha ?? ''));
  const pullRequests: PullRequestMetadata[] = [];
  const reviews: Record<number, ReviewSummary> = {};
  const checks: Record<string, CheckSummary> = {};
  groups.forEach((group, index) => {
    const first = group[0] as CommitMetadata;
    const last = group.at(-1) as CommitMetadata;
    const number = index + 1;
    const open = index >= groups.length - plan.open;
    const closedAt = open ? null : new Date(Date.parse(last.authoredAt) + 3_600_000).toISOString();
    pullRequests.push({
      number,
      state: open ? 'OPEN' : 'MERGED',
      draft: false,
      title: first.message ?? null,
      authorIdentity: first.authorIdentity,
      createdAt: first.authoredAt,
      closedAt,
      mergedAt: closedAt,
      headSha: last.sha,
      baseBranch: 'main',
    });
    const reviewer = plan.reviewer(first.authorIdentity, index);
    reviews[number] = { number, approvals: reviewer ? 1 : 0, changesRequested: 0, commented: reviewer && index % 4 === 0 ? 1 : 0, reviewerIdentities: reviewer ? [reviewer] : [] };
    const failing = plan.failing(index);
    checks[last.sha] = { sha: last.sha, total: 3, succeeded: failing ? 2 : 3, failed: failing ? 1 : 0, pending: 0, other: 0 };
  });
  return { pullRequests: pullRequests.reverse(), reviews, checks };
}

const healthyCommits = plannedCommits(
  'healthyco/platform',
  [
    ...HEALTHY_DEVS.flatMap((author, a) =>
      SUBSYSTEMS.map((path, s) => ({
        author,
        path,
        count: 5,
        from: `2026-0${1 + ((a + s) % 8)}-01T10:00:00Z`,
      })),
    ),
    // The engineering lead commits little; their contribution shows in Jira.
    { author: 'hc-lead-01', path: 'infra', count: 3, from: '2026-04-01T10:00:00Z' },
  ],
  { project: 'HC', issues: 63, every: 1 },
);

// Departed and unmatched identities produce ghost commits; tc-dev-01 alone
// maintains billing/. Signals are deterministic for the acceptance journey.
const troubledCommits = plannedCommits(
  'troubledco/core',
  [
    { author: 'tc-dev-01', path: 'billing', count: 30, from: '2026-01-05T09:00:00Z' },
    { author: 'tc-dev-02', path: 'billing', count: 1, from: '2026-02-10T09:00:00Z' },
    { author: 'tc-dev-02', path: 'web', count: 12, from: '2026-02-01T09:00:00Z' },
    { author: 'tc-dev-03', path: 'web', count: 10, from: '2026-03-01T09:00:00Z' },
    { author: 'tc-dev-04', path: 'api', count: 10, from: '2026-03-01T09:00:00Z' },
    { author: 'tc-dev-05', path: 'api', count: 6, from: '2025-11-01T09:00:00Z' },
    { author: 'tc-dev-05', path: 'api', count: 4, from: '2026-05-01T09:00:00Z' },
    { author: 'tc-contractor-x', path: 'api', count: 7, from: '2026-04-01T09:00:00Z' },
    { author: 'tc-lead-01', path: 'web', count: 2, from: '2026-04-10T09:00:00Z' },
  ],
  // Half the history cites issues; the contractor cites keys no issue has.
  { project: 'TC', issues: 111, every: 2, unmatchedAuthors: ['tc-contractor-x'] },
);

// Small cohort (suppressed aggregates), stale history, commits without
// paths, look-alike identities, and an installation missing contents:read.
const sparseCommits = plannedCommits(
  'sparseco/app',
  [
    { author: 'sc-dev-01', path: 'app', count: 40, from: '2024-03-01T09:00:00Z' },
    { author: 'sc-dev-1', path: '', count: 15, from: '2024-05-01T09:00:00Z' },
    { author: 'sc-dev-02', path: 'app', count: 8, from: '2024-06-01T09:00:00Z' },
  ],
  { project: null, issues: 0, every: 1 },
);

export const GITHUB_FIXTURES: Readonly<Record<string, GitHubFixtureRepository>> = {
  // Every pull request reviewed by a peer, every check green.
  'healthyco/platform': {
    repository: 'healthyco/platform',
    defaultBranch: 'main',
    grantedPermissions: ALL_PERMISSIONS,
    commits: healthyCommits,
    identityMap: current(...HEALTHY_DEVS, 'hc-lead-01'),
    ...plannedPulls(healthyCommits, {
      size: 4,
      open: 2,
      reviewer: (author) => HEALTHY_DEVS[(HEALTHY_DEVS.indexOf(author) + 1) % HEALTHY_DEVS.length] ?? 'hc-lead-01',
      failing: () => false,
    }),
  },
  // Billing changes merge without review; every third pull request fails its checks.
  'troubledco/core': {
    repository: 'troubledco/core',
    defaultBranch: 'main',
    grantedPermissions: ALL_PERMISSIONS,
    commits: troubledCommits,
    identityMap: [
      ...current('tc-dev-01', 'tc-dev-02', 'tc-dev-03', 'tc-dev-04', 'tc-lead-01'),
      { identity: 'tc-dev-05', status: 'DEPARTED', departedOn: '2026-01-31' },
    ],
    ...plannedPulls(troubledCommits, {
      size: 3,
      open: 1,
      reviewer: (author) => (author === 'tc-dev-01' || author === 'tc-contractor-x' ? null : 'tc-lead-01'),
      failing: (index) => index % 3 === 2,
    }),
  },
  // No pull-request or checks permission: review evidence is unavailable, said so.
  'sparseco/app': {
    repository: 'sparseco/app',
    defaultBranch: 'master',
    grantedPermissions: ['metadata:read'],
    commits: sparseCommits,
    identityMap: current('sc-dev-01', 'sc-dev-1', 'sc-dev-02'),
    ...plannedPulls(sparseCommits, { size: 5, open: 0, reviewer: () => null, failing: () => false }),
  },
};
