import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { issueKeysIn } from './cross-links';
import { GitHubFixtureAdapter, GITHUB_FIXTURES } from './github';
import { JiraFixtureAdapter, JIRA_FIXTURES } from './jira';
import { hasKafkaSnapshot, KAFKA_SNAPSHOT_LIMITS, KAFKA_SNAPSHOT_PROJECT, KAFKA_SNAPSHOT_REPOSITORY, KAFKA_SNAPSHOT_SITE, kafkaSnapshot, maskMentions } from './kafka-snapshot';

const scope = { organizationId: 'kafka-demo', dealId: 'kafka-demo', connectionId: 'kafka-demo', credentialRef: null };

/** T-127: the Kafka demo replays a real, recorded slice of apache/kafka and KAFKA; nothing calls out. */
describe('the Kafka demo snapshot', () => {
  it('is committed, bounded and dated', () => {
    expect(hasKafkaSnapshot()).toBe(true);
    const snapshot = kafkaSnapshot();
    expect(snapshot.source).toMatchObject({ repository: 'apache/kafka', jira: 'issues.apache.org/jira', project: 'KAFKA' });
    expect(snapshot.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.github.commits.length).toBeGreaterThan(0);
    expect(snapshot.github.commits.length).toBeLessThanOrEqual(KAFKA_SNAPSHOT_LIMITS.commits);
    expect(snapshot.github.pullRequests.length).toBeLessThanOrEqual(KAFKA_SNAPSHOT_LIMITS.pullRequests);
  });

  it('names no one: people are pseudonymous, with no email, name or @-handle', () => {
    const snapshot = kafkaSnapshot();
    const people = [
      ...snapshot.github.commits.map((commit) => commit.authorIdentity),
      ...snapshot.github.pullRequests.map((pull) => pull.authorIdentity),
      ...Object.values(snapshot.github.reviews).flatMap((review) => review.reviewerIdentities),
      ...snapshot.jira.issues.flatMap((issue) => [issue.assignee?.accountId, issue.reporter?.accountId].filter((id): id is string => Boolean(id))),
    ];
    for (const id of people) expect(id).toMatch(/^kafka-(dev|jira)-[0-9a-f]{8}$/);
    expect(snapshot.github.commits.every((commit) => commit.authorName === null)).toBe(true);
    expect(snapshot.jira.issues.every((issue) => issue.assignee?.displayName == null && issue.reporter?.displayName == null)).toBe(true);
    const text = JSON.stringify(snapshot);
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
    expect(text).not.toMatch(/signed-off-by|co-authored-by/i);
    for (const message of [...snapshot.github.commits.map((commit) => commit.message ?? ''), ...snapshot.github.pullRequests.map((pull) => pull.title ?? '')]) {
      expect(maskMentions(message)).toBe(message);
    }
  });

  it('masks handles but keeps code annotations', () => {
    expect(maskMentions('Thanks @chia7712 and @Shekharrajak; add @Override, @ClusterTest and @param')).toBe('Thanks @[person] and @[person]; add @Override, @ClusterTest and @param');
    expect(maskMentions(null)).toBeNull();
  });

  it('replays through the fixture adapters, linked both ways: code names KAFKA keys, issues find their code', async () => {
    expect(Object.keys(GITHUB_FIXTURES)).toContain(KAFKA_SNAPSHOT_REPOSITORY);
    expect(Object.keys(JIRA_FIXTURES)).toContain(KAFKA_SNAPSHOT_SITE);
    const github = new GitHubFixtureAdapter({ repository: KAFKA_SNAPSHOT_REPOSITORY });
    const jira = new JiraFixtureAdapter({ site: KAFKA_SNAPSHOT_SITE, basePath: '/jira', projectKeys: [KAFKA_SNAPSHOT_PROJECT] });
    expect((await github.validateConnection(scope)).ok).toBe(true);
    expect((await jira.validateConnection(scope)).ok).toBe(true);
    const commits = (await github.listCommits(scope, { cursor: null, limit: 100 })).commits;
    const keyed = commits.find((commit) => issueKeysIn(commit.message).some((key) => key.startsWith('KAFKA-')));
    expect(keyed, 'a commit naming a KAFKA issue').toBeDefined();
    const [issue] = await jira.issuesByKey(scope, issueKeysIn(keyed?.message).filter((key) => key.startsWith('KAFKA-')).slice(0, 1));
    expect(issue?.project).toBe('KAFKA');
    // Issue → code: the recorded commits name the issue.
    expect(kafkaSnapshot().github.commits.some((commit) => issueKeysIn(commit.message).includes(issue?.key ?? ''))).toBe(true);
    expect((await github.listPullRequests(scope, { cursor: null, limit: 10 })).pullRequests.length).toBeGreaterThan(0);
  });

  it('is never rewritten by app code: only the recorder writes fixtures/recorded (the demo refresh leaves it alone)', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const writers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (['node_modules', '.next', 'dist', '.turbo', 'generated', '.git'].includes(name)) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx|mjs|js)$/.test(name) && !name.endsWith('.test.ts')) {
          const source = readFileSync(path, 'utf8');
          if (source.includes('recorded/kafka') && /writeFile/.test(source)) writers.push(path.slice(root.length));
        }
      }
    };
    for (const top of ['apps', 'packages', 'scripts']) walk(join(root, top));
    expect(writers).toEqual(['packages/connectors/scripts/record-kafka-snapshot.ts']);
  });
});
