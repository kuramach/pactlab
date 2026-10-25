import { describe, expect, it } from 'vitest';
import { JiraLiveAdapter } from '../jira';
import { crossLinkSample, kafkaAdapters, scope } from './kafka-pair';

/**
 * Live smoke tests against the public Kafka pair (T-074). Off in the PR gate;
 * run nightly or by hand with `pnpm test:live` (INTEGRATION_LIVE=1). Public
 * instances change under us, so these assert shapes and invariants, never
 * counts. Anonymous GitHub allows 60 requests an hour: the suite stays small;
 * set GITHUB_TOKEN to run authenticated.
 */
const LIVE = process.env['INTEGRATION_LIVE'] === '1';
const token = process.env['GITHUB_TOKEN'];
const platform = (input: string, init?: Parameters<typeof fetch>[1]) => fetch(input, init);

describe.skipIf(!LIVE)('Kafka pair, live', { timeout: 120_000 }, () => {
  const adapters = () =>
    kafkaAdapters({ github: platform, jira: platform }, token ? { method: 'TOKEN', token: async () => token } : undefined);

  it('GitHub: a public repository validates without a credential and lists pull requests with reviews and checks', async () => {
    const { github } = adapters();
    expect((await github.validateConnection(scope)).ok).toBe(true);
    const pulls = await github.listPullRequests(scope, { cursor: null, limit: 2 });
    expect(pulls.pullRequests.length).toBeGreaterThan(0);
    const [pull] = pulls.pullRequests;
    expect(pull?.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect((await github.pullRequestReviews(scope, pull?.number ?? 0)).number).toBe(pull?.number);
    expect((await github.checkRuns(scope, pull?.headSha ?? '')).total).toBeGreaterThanOrEqual(0);
  });

  it('Jira: the approved Apache server answers anonymously and pages issues', async () => {
    const { jira } = adapters();
    expect((await jira.validateConnection(scope)).checks.find((check) => check.name === 'reachability')?.status).toBe('PASS');
    const page = await jira.listIssues(scope, { cursor: null, limit: 2 });
    expect(page.issues.length).toBe(2);
    expect(page.nextCursor).toBe('2');
  });

  it('cross-links resolve both ways on the newest commits and pull requests', async () => {
    const sample = await crossLinkSample(adapters(), 5);
    // Most Kafka commits and pull requests name an issue; resolved keys always find their code again.
    expect(sample.links.length).toBeGreaterThan(0);
    expect(sample.resolved.length).toBeGreaterThan(0);
    for (const entry of sample.back) expect(entry.code.length).toBeGreaterThan(0);
  });

  it('secondary Jira (jira.atlassian.com, JRASERVER) catches host and field assumptions', async () => {
    const atlassian = new JiraLiveAdapter({ site: 'jira.atlassian.com', projectKeys: ['JRASERVER'] }, { fetch: platform, policy: { selfHostedHosts: ['jira.atlassian.com'] } });
    expect((await atlassian.validateConnection(scope)).checks.find((check) => check.name === 'reachability')?.status).toBe('PASS');
    expect((await atlassian.listIssues(scope, { cursor: null, limit: 1 })).issues).toHaveLength(1);
  });
});
