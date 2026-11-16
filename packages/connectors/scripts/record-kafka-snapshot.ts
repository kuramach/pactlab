/**
 * Records the Kafka demo snapshot (T-127): a bounded slice of the real apache/kafka repository and
 * the KAFKA project on issues.apache.org/jira, read once through the live adapters and written as
 * fixture data the fixture adapters replay. The demo never calls GitHub or Jira; this script is the
 * only thing that does, run by hand, once:
 *
 *   export GITHUB_TOKEN=github_pat_...      # read-only, public repositories; never written anywhere
 *   pnpm --filter @pactlab/api exec tsx ../../packages/connectors/scripts/record-kafka-snapshot.ts
 *
 * People are pseudonymised before anything is written: commit and pull-request authors, reviewers
 * and Jira assignees and reporters become stable `kafka-…` ids with no name or email, and
 * @-mentions in messages and titles are masked. The activity
 * (commits, paths, sizes, pull requests, reviews, CI, issues and their links) is real.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { CommitMetadata, ContributorIdentity } from '@pactlab/domain';
import { issueKeysIn } from '../src/cross-links';
import { type CheckSummary, type PullRequestMetadata, type ReviewSummary } from '../src/github';
import type { JiraIssue, JiraPerson, JiraSprint } from '../src/jira';
import { MAX_KEYS_PER_LOOKUP } from '../src/jira/types';
import { kafkaAdapters, scope } from '../src/live/kafka-pair';
import { KAFKA_SNAPSHOT_LIMITS, maskMentions, type KafkaSnapshot } from '../src/kafka-snapshot';

const OUT = new URL('../../../fixtures/recorded/kafka/', import.meta.url);
const token = process.env['GITHUB_TOKEN'];
if (!token) {
  process.stderr.write('Set GITHUB_TOKEN (a read-only fine-grained token for public repositories) first.\n');
  process.exit(1);
}

const pseudonym = (prefix: string, value: string) => `kafka-${prefix}-${createHash('sha256').update(`pactlab-kafka:${value.toLowerCase()}`).digest('hex').slice(0, 8)}`;
const coder = (value: string) => pseudonym('dev', value);
const person = (value: JiraPerson | null): JiraPerson | null => (value ? { accountId: pseudonym('jira', value.accountId), displayName: null } : null);
const log = (line: string) => process.stdout.write(`${line}\n`);

async function main() {
  const { github, jira } = kafkaAdapters({ github: (input, init) => fetch(input, init), jira: (input, init) => fetch(input, init) }, { method: 'TOKEN', token: async () => token as string });
  const head = await github.head(scope);
  log(`apache/kafka @ ${head.headSha.slice(0, 10)} on ${head.defaultBranch}`);

  // Commits, newest first. Each needs a detail request (paths and sizes), so this is the slow part.
  const commits: CommitMetadata[] = [];
  let cursor: string | null = null;
  while (commits.length < KAFKA_SNAPSHOT_LIMITS.commits) {
    const page = await github.listCommits(scope, { cursor, limit: 100 });
    commits.push(...page.commits);
    log(`  commits: ${commits.length}`);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  commits.length = Math.min(commits.length, KAFKA_SNAPSHOT_LIMITS.commits);

  // Pull requests, newest first, with their reviews and the check runs on their head commit.
  const pullRequests: PullRequestMetadata[] = [];
  cursor = null;
  while (pullRequests.length < KAFKA_SNAPSHOT_LIMITS.pullRequests) {
    const page = await github.listPullRequests(scope, { cursor, limit: 100 });
    pullRequests.push(...page.pullRequests);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  pullRequests.length = Math.min(pullRequests.length, KAFKA_SNAPSHOT_LIMITS.pullRequests);
  const reviews: Record<number, ReviewSummary> = {};
  const checks: Record<string, CheckSummary> = {};
  for (const [index, pull] of pullRequests.entries()) {
    const review = await github.pullRequestReviews(scope, pull.number);
    reviews[pull.number] = { ...review, reviewerIdentities: review.reviewerIdentities.map(coder) };
    checks[pull.headSha] = await github.checkRuns(scope, pull.headSha);
    if ((index + 1) % 50 === 0) log(`  pull requests: ${index + 1} with reviews and checks`);
  }

  // The Jira issues the code names, both from commit messages and pull-request titles.
  const keys = [...new Set([...commits.map((commit) => commit.message ?? ''), ...pullRequests.map((pull) => pull.title ?? '')].flatMap((text) => issueKeysIn(text)))].filter((key) => key.startsWith('KAFKA-'));
  const issues: JiraIssue[] = [];
  for (let index = 0; index < keys.length; index += MAX_KEYS_PER_LOOKUP) {
    issues.push(...(await jira.issuesByKey(scope, keys.slice(index, index + MAX_KEYS_PER_LOOKUP))));
  }
  log(`  Jira: ${issues.length} of ${keys.length} cited KAFKA issues found`);
  let sprints: readonly JiraSprint[] = [];
  try {
    sprints = await jira.listSprints(scope);
  } catch {
    log('  Jira sprints: none readable (Apache Jira runs KAFKA without public sprints)');
  }

  const identities = [...new Set(commits.map((commit) => coder(commit.authorIdentity)))].sort();
  const identityMap: ContributorIdentity[] = identities.map((identity) => ({ identity, status: 'CURRENT', departedOn: null }));
  const snapshot: KafkaSnapshot = {
    recordedAt: new Date().toISOString(),
    source: { repository: 'apache/kafka', headSha: head.headSha, defaultBranch: head.defaultBranch, jira: 'issues.apache.org/jira', project: 'KAFKA' },
    github: {
      commits: commits.map(({ authorName: _name, ...commit }) => ({ ...commit, authorIdentity: coder(commit.authorIdentity), authorName: null, message: maskMentions(commit.message ?? null) })),
      identityMap,
      pullRequests: pullRequests.map((pull) => ({ ...pull, authorIdentity: coder(pull.authorIdentity), title: maskMentions(pull.title) })),
      reviews,
      checks,
    },
    jira: {
      issues: issues.map((issue) => ({ ...issue, assignee: person(issue.assignee), reporter: person(issue.reporter) })),
      sprints: [...sprints],
    },
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL('snapshot.json', OUT), `${JSON.stringify(snapshot)}\n`);
  log(`Wrote fixtures/recorded/kafka/snapshot.json: ${snapshot.github.commits.length} commits, ${snapshot.github.pullRequests.length} pull requests, ${snapshot.jira.issues.length} issues, ${identities.length} pseudonymous contributors.`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Recording failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
