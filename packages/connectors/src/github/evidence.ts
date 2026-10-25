import type { CommitMetadata, EvidenceSource, NormalizedEvidence, ObservedPerson, SourceIssue } from '@pactlab/domain';
import type { ConnectionScope } from '../contract';
import { issueKeysIn, type IssueLink } from '../cross-links';
import { contributorKey, monthOf } from '../people';
import { GITHUB_PROVIDER, GitHubAdapterError, type CheckSummary, type GitHubAdapter, type PullRequestMetadata, type ReviewSummary } from './types';

export const REPOSITORY_HEAD_EVIDENCE_TYPE = 'code.repository_head';
export const CODE_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE = 'code.contributor_activity';
export const PULL_REQUEST_EVIDENCE_TYPE = 'code.pull_request';
export const ISSUE_LINK_EVIDENCE_TYPE = 'code.issue_link';

/** Pull requests read per sync, newest first, within the history window. */
export const MAX_PULL_REQUESTS = 2_000;
/** Of those, the newest this many get their reviews and check runs read (two calls each). */
export const MAX_PR_DETAILS = 200;

/** History read for contributor activity: two years, at most this many commits. */
export const MAX_ACTIVITY_COMMITS = 50_000;
const HISTORY_MONTHS = 24;

/** Top-level area of a repository-relative path (`api/x.ts` → `api`; root files → `(root)`). */
const areaOf = (path: string) => (path.includes('/') ? (path.split('/')[0] ?? '(root)') : '(root)');

function monthsBefore(iso: string, months: number): string {
  const date = new Date(iso);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1)).toISOString().slice(0, 7);
}

/**
 * Commit metadata aggregated per contributor per month: counts, line totals
 * and top-level areas touched. Identities become pseudonymous keys; names
 * go to the gated directory only. No file contents; messages appear only
 * on head and link evidence, sanitized.
 */
function contributorActivity(repository: string, dealId: string, commits: readonly CommitMetadata[]): NormalizedEvidence[] {
  const buckets = new Map<string, { key: string; month: string; commits: number; additions: number; deletions: number; areas: Map<string, number>; first: string; last: string }>();
  for (const commit of commits) {
    const key = contributorKey(dealId, commit.authorIdentity);
    const month = monthOf(commit.authoredAt);
    const id = `${key}:${month}`;
    const bucket = buckets.get(id) ?? { key, month, commits: 0, additions: 0, deletions: 0, areas: new Map(), first: commit.authoredAt, last: commit.authoredAt };
    bucket.commits += 1;
    bucket.additions += commit.additions;
    bucket.deletions += commit.deletions;
    for (const area of new Set(commit.paths.map(areaOf))) bucket.areas.set(area, (bucket.areas.get(area) ?? 0) + 1);
    if (commit.authoredAt < bucket.first) bucket.first = commit.authoredAt;
    if (commit.authoredAt > bucket.last) bucket.last = commit.authoredAt;
    buckets.set(id, bucket);
  }
  return [...buckets.values()]
    .sort((a, b) => a.month.localeCompare(b.month) || a.key.localeCompare(b.key))
    .map((bucket) => {
      const canonical = {
        repository,
        contributorKey: bucket.key,
        month: bucket.month,
        commits: String(bucket.commits),
        additions: String(bucket.additions),
        deletions: String(bucket.deletions),
        areas: JSON.stringify(Object.fromEntries([...bucket.areas.entries()].sort(([a], [b]) => a.localeCompare(b)))),
        firstCommitAt: bucket.first,
        lastCommitAt: bucket.last,
      };
      return {
        evidenceType: CODE_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE,
        sourceSystem: GITHUB_PROVIDER,
        sourceRecordId: `${repository}:${bucket.key}:${bucket.month}`,
        observedAt: bucket.last,
        canonical,
        locator: { kind: 'provider_record', system: GITHUB_PROVIDER, site: repository, resource: 'contributor_activity', id: `${bucket.key}:${bucket.month}` },
        quote: JSON.stringify(canonical),
      };
    });
}

function pullRequestEvidence(
  repository: string,
  dealId: string,
  pull: PullRequestMetadata,
  review: ReviewSummary | null,
  checks: CheckSummary | null,
): NormalizedEvidence {
  const count = (value: number | undefined) => (value === undefined ? null : String(value));
  const canonical = {
    repository,
    number: String(pull.number),
    state: pull.state,
    draft: String(pull.draft),
    title: pull.title,
    authorKey: contributorKey(dealId, pull.authorIdentity),
    createdAt: pull.createdAt,
    closedAt: pull.closedAt,
    mergedAt: pull.mergedAt,
    headSha: pull.headSha,
    baseBranch: pull.baseBranch,
    // Null when the pull request is outside the detail window (said so as a source issue).
    approvals: count(review?.approvals),
    changesRequested: count(review?.changesRequested),
    reviewerKeys: review ? JSON.stringify(review.reviewerIdentities.map((identity) => contributorKey(dealId, identity)).sort()) : null,
    checksTotal: count(checks?.total),
    checksFailed: count(checks?.failed),
    checksPending: count(checks?.pending),
  };
  return {
    evidenceType: PULL_REQUEST_EVIDENCE_TYPE,
    sourceSystem: GITHUB_PROVIDER,
    sourceRecordId: `${repository}#${pull.number}`,
    observedAt: pull.mergedAt ?? pull.closedAt ?? pull.createdAt,
    canonical,
    locator: { kind: 'provider_record', system: GITHUB_PROVIDER, site: repository, resource: 'pull_request', id: String(pull.number) },
    quote: JSON.stringify(canonical),
  };
}

/** One link per (commit or pull request, issue key) named in its sanitized message or title. */
function linkEvidence(repository: string, links: readonly (IssueLink & { observedAt: string; text: string })[]): NormalizedEvidence[] {
  return links.map((link) => {
    const canonical = { repository, kind: link.kind, id: link.id, issueKey: link.issueKey, project: link.issueKey.split('-')[0] ?? '' };
    return {
      evidenceType: ISSUE_LINK_EVIDENCE_TYPE,
      sourceSystem: GITHUB_PROVIDER,
      sourceRecordId: `${repository}:${link.kind === 'COMMIT' ? 'commit' : 'pull'}:${link.id}:${link.issueKey}`,
      observedAt: link.observedAt,
      canonical,
      locator:
        link.kind === 'COMMIT'
          ? { kind: 'git_commit', repository, commitSha: link.id }
          : { kind: 'provider_record', system: GITHUB_PROVIDER, site: repository, resource: 'pull_request', id: link.id },
      quote: link.text,
    };
  });
}

/** Commit and pull-request links to issue keys, each key once per source. */
export function issueLinksOf(commits: readonly CommitMetadata[], pulls: readonly PullRequestMetadata[], repository: string) {
  return [
    ...commits.flatMap((commit) => issueKeysIn(commit.message).map((issueKey) => ({ repository, kind: 'COMMIT' as const, id: commit.sha, issueKey, observedAt: commit.authoredAt, text: commit.message ?? '' }))),
    ...pulls.flatMap((pull) => issueKeysIn(pull.title).map((issueKey) => ({ repository, kind: 'PULL_REQUEST' as const, id: String(pull.number), issueKey, observedAt: pull.createdAt, text: pull.title ?? '' }))),
  ];
}

/**
 * Pull requests in the history window, newest first, with reviews and checks
 * for the newest `MAX_PR_DETAILS`. Unreadable pull requests (no permission)
 * or checks become source issues; commit evidence is unaffected.
 */
async function readPullRequests(adapter: GitHubAdapter, scope: ConnectionScope, repository: string, since: string | null) {
  const issues: SourceIssue[] = [];
  const pulls: PullRequestMetadata[] = [];
  let truncated = false;
  try {
    let cursor: string | null = null;
    do {
      const page = await adapter.listPullRequests(scope, { cursor, limit: 100 });
      let stop = false;
      for (const pull of page.pullRequests) {
        if (since && monthOf(pull.createdAt) < since) {
          stop = true;
          break;
        }
        if (pulls.length >= MAX_PULL_REQUESTS) {
          truncated = true;
          stop = true;
          break;
        }
        pulls.push(pull);
      }
      cursor = stop ? null : page.nextCursor;
    } while (cursor !== null);
  } catch (error) {
    if (error instanceof GitHubAdapterError && error.code === 'PERMISSION_DENIED') {
      issues.push({ dataset: repository, row: null, code: 'PERMISSION_DENIED', detail: 'Pull requests are not readable (grant Pull requests: read for review and CI evidence)' });
      return { pulls: [], details: new Map<number, { review: ReviewSummary | null; checks: CheckSummary | null }>(), issues };
    }
    throw error;
  }
  if (truncated) issues.push({ dataset: repository, row: null, code: 'MISSING_FIELD', detail: `Pull-request evidence covers the latest ${MAX_PULL_REQUESTS} pull requests only` });
  if (pulls.length > MAX_PR_DETAILS)
    issues.push({ dataset: repository, row: null, code: 'MISSING_FIELD', detail: `Reviews and checks are read for the latest ${MAX_PR_DETAILS} pull requests only` });
  const details = new Map<number, { review: ReviewSummary | null; checks: CheckSummary | null }>();
  let checksReadable = true;
  for (const pull of pulls.slice(0, MAX_PR_DETAILS)) {
    const review = await adapter.pullRequestReviews(scope, pull.number);
    let checks: CheckSummary | null = null;
    if (checksReadable) {
      try {
        checks = await adapter.checkRuns(scope, pull.headSha);
      } catch (error) {
        if (!(error instanceof GitHubAdapterError) || error.code !== 'PERMISSION_DENIED') throw error;
        checksReadable = false;
        issues.push({ dataset: repository, row: null, code: 'PERMISSION_DENIED', detail: 'Check runs are not readable (grant Checks: read for CI evidence)' });
      }
    }
    details.set(pull.number, { review, checks });
  }
  return { pulls, details, issues };
}

/**
 * Evidence for the analysed state of a repository: one record per head
 * commit. Code findings cite it with the exact commit, so a finding resolves
 * to repository, commit and the tool that produced it. Metadata only — no
 * file contents are read or stored.
 */
export function createGitHubEvidenceSource(
  adapter: GitHubAdapter,
  scope: ConnectionScope,
): EvidenceSource {
  return {
    provider: GITHUB_PROVIDER,
    version: adapter.version,
    async pull() {
      const head = await adapter.head(scope);
      const commit = (await adapter.listCommits(scope, { cursor: null, limit: 1 })).commits[0];

      // Commit history for contributor activity, bounded in time and size.
      const since = commit ? monthsBefore(commit.authoredAt, HISTORY_MONTHS) : null;
      const commits: CommitMetadata[] = [];
      let cursor: string | null = null;
      let truncated = false;
      do {
        const page = await adapter.listCommits(scope, { cursor, limit: 100 });
        let stop = false;
        for (const [index, item] of page.commits.entries()) {
          // Providers list newest first: the first commit older than the window ends the read.
          if (since && monthOf(item.authoredAt) < since) {
            stop = true;
            break;
          }
          commits.push(item);
          if (commits.length >= MAX_ACTIVITY_COMMITS) {
            truncated = index < page.commits.length - 1 || page.nextCursor !== null;
            stop = true;
            break;
          }
        }
        cursor = stop ? null : page.nextCursor;
      } while (cursor !== null);
      const identities = new Map((await adapter.identityMap(scope)).map((entry) => [entry.identity, entry.status]));
      const people = new Map<string, ObservedPerson>();
      for (const item of commits) {
        if (people.has(item.authorIdentity)) continue;
        people.set(item.authorIdentity, {
          contributorKey: contributorKey(scope.dealId, item.authorIdentity),
          system: 'github',
          identity: item.authorIdentity,
          displayName: item.authorName ?? null,
          status: identities.get(item.authorIdentity) ?? 'UNKNOWN',
        });
      }
      const activityIssues: SourceIssue[] = truncated
        ? [{ dataset: head.repository, row: null, code: 'MISSING_FIELD', detail: `Contributor activity covers the latest ${MAX_ACTIVITY_COMMITS} commits only` }]
        : [];
      const pullRequests = await readPullRequests(adapter, scope, head.repository, since);
      const record: NormalizedEvidence = {
        evidenceType: REPOSITORY_HEAD_EVIDENCE_TYPE,
        sourceSystem: GITHUB_PROVIDER,
        sourceRecordId: `${head.repository}@${head.headSha}`,
        observedAt: commit?.sha === head.headSha ? commit.committedAt : null,
        canonical: {
          repository: head.repository,
          defaultBranch: head.defaultBranch,
          headSha: head.headSha,
          // The head commit's sanitized message, when the provider gave one.
          ...(commit?.sha === head.headSha && commit.message ? { message: commit.message } : {}),
        },
        locator: { kind: 'git_commit', repository: head.repository, commitSha: head.headSha },
        quote: `${head.repository}@${head.headSha}`,
      };
      const pullRecords = pullRequests.pulls.map((pull) => {
        const detail = pullRequests.details.get(pull.number);
        return pullRequestEvidence(head.repository, scope.dealId, pull, detail?.review ?? null, detail?.checks ?? null);
      });
      return {
        records: [
          record,
          ...contributorActivity(head.repository, scope.dealId, commits),
          ...pullRecords,
          ...linkEvidence(head.repository, issueLinksOf(commits, pullRequests.pulls, head.repository)),
        ],
        issues: [...activityIssues, ...pullRequests.issues],
        people: [...people.values()],
      };
    },
  };
}
