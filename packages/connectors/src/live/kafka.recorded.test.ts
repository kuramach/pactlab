import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { cassetteFetch, type Cassette } from '../http/cassette';
import { crossLinkSample, kafkaAdapters, scope } from './kafka-pair';

const load = async (name: string): Promise<Cassette> => JSON.parse(await readFile(new URL(`../../../../fixtures/cassettes/${name}.json`, import.meta.url), 'utf8')) as Cassette;
async function recorded() {
  const github = cassetteFetch(await load('github/apache__kafka'));
  const jira = cassetteFetch(await load('jira/apache-kafka'));
  return { ...kafkaAdapters({ github, jira }), requests: { github: github.requests, jira: jira.requests } };
}

/**
 * The Kafka pair, replayed from cassettes recorded by
 * `scripts/record-cassettes.ts` (T-074). No network: any request not recorded
 * fails the test.
 */
describe('apache/kafka on GitHub (recorded, anonymous)', () => {
  it('validates as a public repository and reads the default branch head', async () => {
    const { github } = await recorded();
    const validation = await github.validateConnection(scope);
    expect(validation.ok).toBe(true);
    expect(validation.checks.find((check) => check.name === 'credentials')).toMatchObject({ status: 'SKIPPED' });
    expect(validation.checks.find((check) => check.name === 'scopes')?.detail).toBe('Commit history and pull requests are readable');
    expect(await github.head(scope)).toMatchObject({ repository: 'apache/kafka', defaultBranch: 'trunk', headSha: expect.stringMatching(/^[0-9a-f]{40}$/) });
  });

  it('pages commits with sanitized messages that carry KAFKA keys and no people', async () => {
    const { github } = await recorded();
    const first = await github.listCommits(scope, { cursor: null, limit: 3 });
    expect(first.commits).toHaveLength(3);
    expect(first.nextCursor).toBe('2');
    const second = await github.listCommits(scope, { cursor: first.nextCursor, limit: 3 });
    expect(second.commits).toHaveLength(3);
    const all = [...first.commits, ...second.commits];
    expect(new Set(all.map((commit) => commit.sha)).size).toBe(6);
    expect(all.every((commit) => commit.authorIdentity.endsWith('@example.invalid'))).toBe(true);
    for (const commit of all) expect(commit.message ?? '').not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}|^reviewers:|^signed-off-by:/im);
    expect(all.some((commit) => /KAFKA-\d+/.test(commit.message ?? ''))).toBe(true);
  });

  it('pages pull requests and reads their reviews and check runs', async () => {
    const { github } = await recorded();
    const first = await github.listPullRequests(scope, { cursor: null, limit: 3 });
    expect(first.pullRequests).toHaveLength(3);
    expect(first.nextCursor).toBe('2');
    expect((await github.listPullRequests(scope, { cursor: '2', limit: 3 })).pullRequests).toHaveLength(3);
    for (const pull of first.pullRequests) {
      expect(pull.baseBranch).toBe('trunk');
      const review = await github.pullRequestReviews(scope, pull.number);
      expect(review.approvals + review.changesRequested + review.commented).toBeGreaterThanOrEqual(0);
      expect(review.reviewerIdentities.every((login) => /^author-[0-9a-f]{10}$/.test(login))).toBe(true);
      const checks = await github.checkRuns(scope, pull.headSha);
      expect(checks.succeeded + checks.failed + checks.pending + checks.other).toBeLessThanOrEqual(checks.total);
    }
  });
});

describe('project KAFKA on issues.apache.org/jira (recorded, anonymous Data Center)', () => {
  it('validates the approved self-hosted site, the project and the field mappings', async () => {
    const { jira } = await recorded();
    const validation = await jira.validateConnection(scope);
    expect(Object.fromEntries(validation.checks.map((check) => [check.name, check.status]))).toEqual({ reachability: 'PASS', credentials: 'SKIPPED', scopes: 'PASS', mappings: 'PASS' });
    expect(validation.checks.find((check) => check.name === 'mappings')?.detail).toBe('Story points: mapped; sprints: mapped');
  });

  it('pages issues by startAt with history, and never requests free text', async () => {
    const { jira, requests } = await recorded();
    const first = await jira.listIssues(scope, { cursor: null, limit: 3 });
    expect(first.issues.map((issue) => issue.key)).toEqual(['KAFKA-1', 'KAFKA-2', 'KAFKA-3']);
    expect(first.nextCursor).toBe('3');
    const second = await jira.listIssues(scope, { cursor: first.nextCursor, limit: 3 });
    expect(second.issues).toHaveLength(3);
    for (const issue of [...first.issues, ...second.issues]) {
      expect(issue.project).toBe('KAFKA');
      expect(['Story', 'Bug', 'Task']).toContain(issue.type);
      expect(issue.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(issue.reopenCount).toBeGreaterThanOrEqual(0);
      if (issue.assignee) expect(issue.assignee.accountId).toMatch(/^user-[0-9a-f]{10}$/);
    }
    expect(requests.jira.some((request) => /summary|description/.test(request))).toBe(false);
  });

  it('reports agile boards closed to anonymous reads as unreadable sprints', async () => {
    const { jira } = await recorded();
    // The evidence source turns this into a source issue rather than a failed sync (T-082).
    await expect(jira.listSprints(scope)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', message: 'Sprints are not readable on this site' });
  });
});

describe('the Kafka cross-link (recorded)', () => {
  it('resolves code to issues and issues back to code, on a fixed sample', async () => {
    const sample = await crossLinkSample(await recorded());
    expect(sample.links.length).toBeGreaterThan(0);
    // Code → issue: every key the sample names is a real KAFKA issue.
    expect(sample.resolved).toEqual(sample.links);
    expect(sample.issues.map((issue) => issue.key).sort()).toEqual(['KAFKA-18574', 'KAFKA-20925', 'KAFKA-21290']);
    // Issue → code: each issue finds the commit or pull request that names it.
    for (const entry of sample.back) expect(entry.code.length, entry.key).toBeGreaterThan(0);
    expect(new Set(sample.links.map((link) => link.kind))).toEqual(new Set(['COMMIT', 'PULL_REQUEST']));
  });
});
