import type { CommitMetadata, EvidenceSource, NormalizedEvidence, ObservedPerson, SourceIssue } from '@pactlab/domain';
import type { ConnectionScope } from '../contract';
import { contributorKey, monthOf } from '../people';
import { GITHUB_PROVIDER, type GitHubAdapter } from './types';

export const REPOSITORY_HEAD_EVIDENCE_TYPE = 'code.repository_head';
export const CODE_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE = 'code.contributor_activity';

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
 * go to the gated directory only. No file contents, no commit messages.
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
      const record: NormalizedEvidence = {
        evidenceType: REPOSITORY_HEAD_EVIDENCE_TYPE,
        sourceSystem: GITHUB_PROVIDER,
        sourceRecordId: `${head.repository}@${head.headSha}`,
        observedAt: commit?.sha === head.headSha ? commit.committedAt : null,
        canonical: {
          repository: head.repository,
          defaultBranch: head.defaultBranch,
          headSha: head.headSha,
        },
        locator: { kind: 'git_commit', repository: head.repository, commitSha: head.headSha },
        quote: `${head.repository}@${head.headSha}`,
      };
      return {
        records: [record, ...contributorActivity(head.repository, scope.dealId, commits)],
        issues: activityIssues,
        people: [...people.values()],
      };
    },
  };
}
