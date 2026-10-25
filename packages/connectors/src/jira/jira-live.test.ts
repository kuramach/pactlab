import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { MemorySecretStore } from '../credentials';
import { cassetteFetch, type Cassette, type FetchLike } from '../http/cassette';
import { createJiraEvidenceSource, jiraDate, JiraLiveAdapter, jiraSiteProblem, normalizeIssueType, parseSelfHostedHosts, sprintIdOf } from './index';

const scope = (credentialRef: string | null = null) => ({ organizationId: 'o', dealId: 'd', connectionId: 'c', credentialRef });
const cassette = async (name: string): Promise<Cassette> =>
  JSON.parse(await readFile(new URL(`../../../../fixtures/cassettes/jira/${name}.json`, import.meta.url), 'utf8')) as Cassette;
const APACHE = { selfHostedHosts: ['issues.apache.org'] };

async function apache(projectKeys = ['KAFKA']) {
  const replay = cassetteFetch(await cassette('apache-kafka-datacenter'));
  return { replay, live: new JiraLiveAdapter({ site: 'issues.apache.org', basePath: '/jira', projectKeys }, { fetch: replay, policy: APACHE }) };
}

async function cloud() {
  const secrets = new MemorySecretStore();
  await secrets.put('secretref:jira/cloud', 'reader@example.invalid:synthetic-api-token');
  const calls: Record<string, string>[] = [];
  const replay = cassetteFetch(await cassette('cloud-synthetic'));
  const recording: FetchLike = async (input, init) => {
    calls.push(init?.headers ?? {});
    return replay(input, init);
  };
  return { calls, live: new JiraLiveAdapter({ site: 'pactlab-synthetic.atlassian.net', projectKeys: ['SYN'] }, { fetch: recording, secrets }) };
}

describe('Jira site allowlist (T-082)', () => {
  it('allows Atlassian Cloud always and a self-hosted server only when the operator lists it', () => {
    expect(jiraSiteProblem('acme.atlassian.net', { selfHostedHosts: [] })).toBeNull();
    expect(jiraSiteProblem('issues.apache.org', APACHE)).toBeNull();
    expect(jiraSiteProblem('jira.example.org', APACHE)).toBe("jira.example.org is not on this deployment's approved Jira servers; ask your Pactlab operator to add it");
    expect(parseSelfHostedHosts(' issues.apache.org, Jira.Example.org ,')).toEqual(['issues.apache.org', 'jira.example.org']);
    for (const bad of ['10.0.0.1', 'localhost', 'https://x.org', 'acme.atlassian.net']) expect(() => parseSelfHostedHosts(bad), bad).toThrow(/JIRA_SELF_HOSTED_HOSTS/);
  });

  it('refuses a host that is not allowlisted before any request, with the specific reason', async () => {
    const calls: string[] = [];
    const live = new JiraLiveAdapter({ site: 'issues.apache.org', basePath: '/jira', projectKeys: ['KAFKA'] }, { fetch: async (url) => (calls.push(url), new Response('{}')) });
    const validation = await live.validateConnection(scope());
    expect(validation.ok).toBe(false);
    expect(validation.checks[0]).toMatchObject({ name: 'reachability', status: 'FAIL', detail: expect.stringContaining('not on this deployment') });
    await expect(live.listIssues(scope(), { cursor: null, limit: 2 })).rejects.toMatchObject({ code: 'SITE_NOT_ALLOWED' });
    expect(calls).toEqual([]);
  });

  it('never follows a redirect', async () => {
    const seen: (string | undefined)[] = [];
    const live = new JiraLiveAdapter({ site: 'issues.apache.org', projectKeys: ['KAFKA'] }, {
      policy: APACHE,
      fetch: async (_url, init) => (seen.push(init?.redirect), new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/' } })),
    });
    expect((await live.validateConnection(scope())).checks[0]).toMatchObject({ status: 'FAIL', detail: expect.stringMatching(/redirect/) });
    expect(seen).toEqual(['manual']);
  });
});

describe('Jira Data Center, anonymously (issues.apache.org shape)', () => {
  it('validates reachability, anonymous access, projects and field mappings', async () => {
    const { live } = await apache(['KAFKA', 'NOPE']);
    const validation = await live.validateConnection(scope());
    expect(Object.fromEntries(validation.checks.map((check) => [check.name, [check.status, check.detail]]))).toEqual({
      reachability: ['PASS', 'issues.apache.org answers (Jira Data Center)'],
      credentials: ['SKIPPED', 'No credential: anonymous read, public projects only'],
      scopes: ['PASS', 'Not readable: NOPE'],
      mappings: ['PASS', 'Story points: mapped; sprints: mapped'],
    });
    expect(validation.ok).toBe(true);
  });

  it('pages with startAt and maps types, priorities, sprints, people and reopens', async () => {
    const { live, replay } = await apache();
    const first = await live.listIssues(scope(), { cursor: null, limit: 2 });
    expect(first.nextCursor).toBe('2');
    const [improvement, bug] = first.issues;
    expect(improvement).toMatchObject({ key: 'KAFKA-21352', type: 'Story', providerType: 'Improvement', statusCategory: 'TO_DO', priority: 'High', storyPoints: 3, sprintId: null, resolvedAt: null, commentCount: 1 });
    expect(bug).toMatchObject({ key: 'KAFKA-21353', type: 'Bug', statusCategory: 'DONE', priority: 'Highest', sprintId: '812', reopenCount: 1, resolvedAt: '2026-10-25T04:40:17.000Z', commentCount: 4 });
    expect(bug?.assignee).toEqual({ accountId: 'JIRAUSER0000002', displayName: 'Assignee Two (synthetic)' });
    expect(bug).not.toHaveProperty('providerType');
    const second = await live.listIssues(scope(), { cursor: first.nextCursor, limit: 2 });
    expect(second).toMatchObject({ nextCursor: null, issues: [{ key: 'KAFKA-21354', type: 'Task', providerType: 'Sub-task', priority: 'Low' }] });
    expect(second.gaps).toEqual([{ code: 'MISSING_FIELD', detail: 'Issue history was not returned, so reopen counts read as zero for some issues' }]);
    // Free text is never requested.
    expect(replay.requests.some((request) => /summary|description/.test(request))).toBe(false);
    await expect(live.listIssues(scope(), { cursor: 'abc', limit: 2 })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('as evidence: boards closed to anonymous reads become a source issue, not a failure', async () => {
    const { live } = await apache();
    const pull = await createJiraEvidenceSource(live, scope()).pull();
    expect(pull.records.filter((record) => record.evidenceType === 'delivery.issue')).toHaveLength(3);
    expect(pull.records.find((record) => record.sourceRecordId === 'KAFKA-21352')?.canonical).toMatchObject({ type: 'Story', providerType: 'Improvement' });
    expect(pull.issues.map((issue) => issue.detail)).toEqual(expect.arrayContaining(['Sprints are not readable on this site']));
  });
});

describe('Jira Cloud with an API token (enhanced search)', () => {
  it('sends Basic auth, pages by nextPageToken and reads sprints with their points', async () => {
    const { live, calls } = await cloud();
    const validation = await live.validateConnection(scope('secretref:jira/cloud'));
    expect(validation.ok).toBe(true);
    expect(calls[0]?.['authorization']).toBe(`Basic ${Buffer.from('reader@example.invalid:synthetic-api-token').toString('base64')}`);
    const first = await live.listIssues(scope('secretref:jira/cloud'), { cursor: null, limit: 1 });
    expect(first).toMatchObject({ nextCursor: 'CAEaAggD', issues: [{ key: 'SYN-1', storyPoints: 5, sprintId: '42', assignee: { accountId: '712020:synthetic-dev' } }] });
    expect((await live.listIssues(scope('secretref:jira/cloud'), { cursor: first.nextCursor, limit: 1 })).nextCursor).toBeNull();
    const sprints = await live.listSprints(scope('secretref:jira/cloud'));
    expect(sprints).toEqual([
      { id: '42', project: 'SYN', name: 'SYN Sprint 5', state: 'active', startAt: '2026-09-08T09:00:00.000Z', endAt: '2026-09-22T09:00:00.000Z', committedPoints: 8, completedPoints: 5 },
      { id: '41', project: 'SYN', name: 'SYN Sprint 4', state: 'closed', startAt: '2026-08-25T09:00:00.000Z', endAt: '2026-09-08T09:00:00.000Z', committedPoints: 5, completedPoints: 5 },
    ]);
  });

  it('refuses a Cloud credential that is not email:token', async () => {
    const secrets = new MemorySecretStore();
    await secrets.put('secretref:jira/bad', 'just-a-token');
    const live = new JiraLiveAdapter({ site: 'pactlab-synthetic.atlassian.net', projectKeys: ['SYN'] }, { fetch: async () => new Response('{}'), secrets });
    await expect(live.listIssues(scope('secretref:jira/bad'), { cursor: null, limit: 1 })).rejects.toMatchObject({ code: 'NO_CREDENTIAL' });
  });
});

describe('Jira field helpers', () => {
  it('normalizes types, dates and sprint values', () => {
    expect(['Bug', 'Defect', 'Story', 'New Feature', 'Improvement', 'Epic', 'Sub-task', 'Test'].map(normalizeIssueType)).toEqual(['Bug', 'Bug', 'Story', 'Story', 'Story', 'Story', 'Task', 'Task']);
    expect(jiraDate('2026-10-24T01:07:35.000+0000')).toBe('2026-10-24T01:07:35.000Z');
    expect(jiraDate('nope')).toBeNull();
    expect(sprintIdOf([{ id: 3 }, { id: 9 }])).toBe('9');
    expect(sprintIdOf(['com.atlassian.greenhopper.service.sprint.Sprint@1[rapidViewId=4,id=77,state=ACTIVE]'])).toBe('77');
    expect(sprintIdOf(null)).toBeNull();
  });
});
